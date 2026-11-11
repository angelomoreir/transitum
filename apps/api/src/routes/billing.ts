import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  billingOverviewSchema,
  changePlanSchema,
  planDtoSchema,
  saasInvoiceDtoSchema,
  subscriptionDtoSchema,
} from "@transitum/shared";
import {
  apiKeys,
  plans,
  subscriptionInvoices,
  subscriptions,
  tenants,
  users,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import {
  getSubscriptionWithPlan,
  toInvoiceDto,
  toPlanDto,
  toSubscriptionDto,
} from "../lib/billing.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { nextNumber } from "../lib/sequences.js";

const INVOICE_DUE_DAYS = 14;

export const billingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/billing/plans",
    {
      preHandler: app.requirePermission("billing:read"),
      schema: { response: { 200: z.object({ items: z.array(planDtoSchema) }) } },
    },
    async () => {
      const items = await app.db
        .select()
        .from(plans)
        .where(eq(plans.active, true))
        .orderBy(asc(plans.sort));
      return { items: items.map(toPlanDto) };
    },
  );

  app.get(
    "/billing",
    {
      preHandler: app.requirePermission("billing:read"),
      schema: { response: { 200: billingOverviewSchema } },
    },
    async (req) => {
      const sp = await getSubscriptionWithPlan(app.db, req.user.tid);
      if (!sp) throw notFound("Subscrição não encontrada");

      const [[usersCount], [keysCount], invoiceRows] = await Promise.all([
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.tenantId, req.user.tid), eq(users.status, "active"))),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(apiKeys)
          .where(and(eq(apiKeys.tenantId, req.user.tid), eq(apiKeys.active, true))),
        app.db
          .select()
          .from(subscriptionInvoices)
          .where(eq(subscriptionInvoices.tenantId, req.user.tid))
          .orderBy(desc(subscriptionInvoices.createdAt)),
      ]);

      return {
        subscription: toSubscriptionDto(sp.sub, sp.plan),
        usage: { users: usersCount.count, apiKeys: keysCount.count },
        invoices: invoiceRows.map(toInvoiceDto),
      };
    },
  );

  app.post(
    "/billing/plan",
    {
      preHandler: app.requirePermission("billing:write"),
      schema: {
        body: changePlanSchema,
        response: { 200: z.object({ subscription: subscriptionDtoSchema }) },
      },
    },
    async (req) => {
      const [plan] = await app.db
        .select()
        .from(plans)
        .where(and(eq(plans.id, req.body.planId), eq(plans.active, true)));
      if (!plan) throw notFound("Plano não encontrado");

      const sp = await getSubscriptionWithPlan(app.db, req.user.tid);
      if (!sp) throw notFound("Subscrição não encontrada");
      if (sp.sub.status === "cancelled") {
        throw forbidden("Subscrição cancelada — reative a conta primeiro");
      }

      const [updated] = await app.db
        .update(subscriptions)
        .set({ planId: plan.id, updatedAt: new Date() })
        .where(eq(subscriptions.tenantId, req.user.tid))
        .returning();
      await app.db
        .update(tenants)
        .set({ plan: plan.code, updatedAt: new Date() })
        .where(eq(tenants.id, req.user.tid));
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "billing.plan_changed",
        entity: "subscription",
        entityId: updated.id,
        metadata: { from: sp.plan.code, to: plan.code },
        ip: req.ip,
      });
      return { subscription: toSubscriptionDto(updated, plan) };
    },
  );

  // Emissão manual de fatura para o período corrente
  app.post(
    "/billing/invoices",
    {
      preHandler: app.requirePermission("billing:write"),
      schema: { response: { 201: z.object({ invoice: saasInvoiceDtoSchema }) } },
    },
    async (req, reply) => {
      const sp = await getSubscriptionWithPlan(app.db, req.user.tid);
      if (!sp) throw notFound("Subscrição não encontrada");
      if (sp.sub.status === "cancelled") {
        throw badRequest("Subscrição cancelada — sem faturação");
      }
      const number = await nextNumber(app.db, req.user.tid, "invoice");
      const [invoice] = await app.db
        .insert(subscriptionInvoices)
        .values({
          tenantId: req.user.tid,
          number,
          amount: sp.plan.priceMonthly,
          currency: sp.plan.currency,
          description: `Subscrição ${sp.plan.name} — período corrente`,
          dueAt: new Date(Date.now() + INVOICE_DUE_DAYS * 86_400_000),
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "billing.invoice_issued",
        entity: "subscription_invoice",
        entityId: invoice.id,
        metadata: { number, amount: invoice.amount },
        ip: req.ip,
      });
      return reply.code(201).send({ invoice: toInvoiceDto(invoice) });
    },
  );

  app.post(
    "/billing/invoices/:id/pay",
    {
      preHandler: app.requirePermission("billing:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ invoice: saasInvoiceDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await app.db
        .select()
        .from(subscriptionInvoices)
        .where(
          and(
            eq(subscriptionInvoices.id, req.params.id),
            eq(subscriptionInvoices.tenantId, req.user.tid),
          ),
        );
      if (!row) throw notFound("Fatura não encontrada");
      if (row.status === "paid") throw badRequest("Fatura já paga");
      if (row.status === "void") throw badRequest("Fatura anulada");

      const now = new Date();
      const [invoice] = await app.db
        .update(subscriptionInvoices)
        .set({ status: "paid", paidAt: now })
        .where(eq(subscriptionInvoices.id, row.id))
        .returning();

      // Pagamento ativa a subscrição e abre novo período mensal
      const sp = await getSubscriptionWithPlan(app.db, req.user.tid);
      if (sp && (sp.sub.status === "trialing" || sp.sub.status === "past_due")) {
        await app.db
          .update(subscriptions)
          .set({
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
            updatedAt: now,
          })
          .where(eq(subscriptions.tenantId, req.user.tid));
      }
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "billing.invoice_paid",
        entity: "subscription_invoice",
        entityId: invoice.id,
        metadata: { number: invoice.number },
        ip: req.ip,
      });
      return { invoice: toInvoiceDto(invoice) };
    },
  );

  app.post(
    "/billing/invoices/:id/void",
    {
      preHandler: app.requirePermission("billing:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ invoice: saasInvoiceDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await app.db
        .select()
        .from(subscriptionInvoices)
        .where(
          and(
            eq(subscriptionInvoices.id, req.params.id),
            eq(subscriptionInvoices.tenantId, req.user.tid),
          ),
        );
      if (!row) throw notFound("Fatura não encontrada");
      if (row.status !== "open") throw badRequest("Só faturas em aberto podem ser anuladas");
      const [invoice] = await app.db
        .update(subscriptionInvoices)
        .set({ status: "void" })
        .where(eq(subscriptionInvoices.id, row.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "billing.invoice_voided",
        entity: "subscription_invoice",
        entityId: invoice.id,
        metadata: { number: invoice.number },
        ip: req.ip,
      });
      return { invoice: toInvoiceDto(invoice) };
    },
  );
};

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  adminInvoiceDtoSchema,
  adminTenantDtoSchema,
  changePlanSchema,
  subscriptionStatusSchema,
} from "@blujay/shared";
import {
  plans,
  platformAdmins,
  subscriptionInvoices,
  subscriptions,
  tenants,
  users,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { toInvoiceDto } from "../lib/billing.js";
import { forbidden, notFound, unauthorized } from "../lib/errors.js";
import { notifyUsersDirect } from "../lib/notify.js";

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  // Todos os endpoints /api/admin exigem platform admin (além de JWT válido)
  const requirePlatformAdmin = async (req: Parameters<typeof app.authenticate>[0]) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized();
    }
    const [row] = await app.db
      .select({ userId: platformAdmins.userId })
      .from(platformAdmins)
      .where(eq(platformAdmins.userId, req.user.sub));
    if (!row) throw forbidden("Acesso reservado a administradores da plataforma");
  };

  app.get(
    "/tenants",
    {
      preHandler: requirePlatformAdmin,
      schema: {
        response: { 200: z.object({ items: z.array(adminTenantDtoSchema) }) },
      },
    },
    async () => {
      const rows = await app.db
        .select({
          t: tenants,
          sub: subscriptions,
          plan: plans,
          usersCount: sql<number>`(
            select count(*)::int from ${users} u where u.tenant_id = ${tenants.id}
          )`,
        })
        .from(tenants)
        .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
        .leftJoin(plans, eq(subscriptions.planId, plans.id))
        .orderBy(asc(tenants.createdAt));

      return {
        items: rows.map((r) => ({
          id: r.t.id,
          name: r.t.name,
          slug: r.t.slug,
          createdAt: r.t.createdAt.toISOString(),
          suspendedAt: r.t.suspendedAt?.toISOString() ?? null,
          usersCount: r.usersCount,
          planCode: r.plan?.code ?? null,
          planName: r.plan?.name ?? null,
          subscriptionStatus: (r.sub?.status ?? null) as z.infer<
            typeof subscriptionStatusSchema
          > | null,
        })),
      };
    },
  );

  app.post(
    "/tenants/:id/plan",
    {
      preHandler: requirePlatformAdmin,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: changePlanSchema,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      const [plan] = await app.db
        .select()
        .from(plans)
        .where(and(eq(plans.id, req.body.planId), eq(plans.active, true)));
      if (!plan) throw notFound("Plano não encontrado");

      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, req.params.id));
      if (!tenant) throw notFound("Tenant não encontrado");

      await app.db
        .update(subscriptions)
        .set({ planId: plan.id, updatedAt: new Date() })
        .where(eq(subscriptions.tenantId, tenant.id));
      await app.db
        .update(tenants)
        .set({ plan: plan.code, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
      await audit(app.db, {
        tenantId: tenant.id,
        actorId: req.user.sub,
        action: "admin.plan_changed",
        entity: "subscription",
        entityId: tenant.id,
        metadata: { to: plan.code },
        ip: req.ip,
      });
      return { ok: true };
    },
  );

  app.post(
    "/tenants/:id/suspend",
    {
      preHandler: requirePlatformAdmin,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, req.params.id));
      if (!tenant) throw notFound("Tenant não encontrado");
      await app.db
        .update(tenants)
        .set({ suspendedAt: new Date(), updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
      await audit(app.db, {
        tenantId: tenant.id,
        actorId: req.user.sub,
        action: "admin.tenant_suspended",
        entity: "tenant",
        entityId: tenant.id,
        ip: req.ip,
      });
      await notifyUsersDirect(app.db, {
        tenantId: tenant.id,
        type: "admin.tenant_suspended",
        title: "Conta suspensa",
        body: "A conta foi suspensa pelo administrador da plataforma. Contacte o suporte.",
      });
      return { ok: true };
    },
  );

  app.post(
    "/tenants/:id/activate",
    {
      preHandler: requirePlatformAdmin,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, req.params.id));
      if (!tenant) throw notFound("Tenant não encontrado");
      await app.db
        .update(tenants)
        .set({ suspendedAt: null, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
      await audit(app.db, {
        tenantId: tenant.id,
        actorId: req.user.sub,
        action: "admin.tenant_reactivated",
        entity: "tenant",
        entityId: tenant.id,
        ip: req.ip,
      });
      await notifyUsersDirect(app.db, {
        tenantId: tenant.id,
        type: "admin.tenant_reactivated",
        title: "Conta reativada",
        body: "A conta foi reativada. Já pode utilizar a plataforma normalmente.",
      });
      return { ok: true };
    },
  );

  app.get(
    "/invoices",
    {
      preHandler: requirePlatformAdmin,
      schema: {
        response: { 200: z.object({ items: z.array(adminInvoiceDtoSchema) }) },
      },
    },
    async () => {
      const rows = await app.db
        .select({ inv: subscriptionInvoices, tenantName: tenants.name })
        .from(subscriptionInvoices)
        .innerJoin(tenants, eq(subscriptionInvoices.tenantId, tenants.id))
        .orderBy(desc(subscriptionInvoices.createdAt));
      return {
        items: rows.map((r) => ({ ...toInvoiceDto(r.inv), tenantName: r.tenantName })),
      };
    },
  );
};

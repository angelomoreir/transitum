import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  carrierInvoiceCreateSchema,
  carrierInvoiceDtoSchema,
  listCarrierInvoicesQuerySchema,
} from "@transitum/shared";
import { z } from "zod";
import { carrierInvoices, partners, shipmentCosts, shipments } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest } from "../lib/errors.js";
import { alias } from "drizzle-orm/pg-core";

const listResponse = z.object({
  items: z.array(carrierInvoiceDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  summary: z.object({
    pending: z.number(),
    matched: z.number(),
    discrepancy: z.number(),
    totalVariance: z.number(),
  }),
});

/** Tolerância absoluta para considerar a fatura conforme (arredondamentos). */
const MATCH_TOLERANCE = 0.01;

/**
 * Auditoria de faturas de frete — compara o valor faturado pela transportadora
 * com a soma dos custos `freight` registados na expedição.
 */
export const freightInvoiceRoutes: FastifyPluginAsyncZod = async (app) => {
  const carriers = alias(partners, "carriers");

  const toDto = (
    inv: typeof carrierInvoices.$inferSelect,
    carrierName: string | null,
    shipmentNumber: string | null,
  ) => ({
    id: inv.id,
    carrierId: inv.carrierId,
    carrierName: carrierName ?? "",
    shipmentId: inv.shipmentId,
    shipmentNumber,
    invoiceNumber: inv.invoiceNumber,
    amount: inv.amount,
    currency: inv.currency,
    expectedAmount: inv.expectedAmount,
    variance: inv.variance,
    status: inv.status,
    issuedAt: inv.issuedAt ?? null,
    note: inv.note ?? null,
    createdAt: inv.createdAt.toISOString(),
  });

  app.get(
    "/",
    {
      preHandler: app.requirePermission("costs:read"),
      schema: { querystring: listCarrierInvoicesQuerySchema, response: { 200: listResponse } },
    },
    async (req) => {
      const { page, pageSize, carrierId, status } = req.query;
      const conditions = [eq(carrierInvoices.tenantId, req.user.tid)];
      if (carrierId) conditions.push(eq(carrierInvoices.carrierId, carrierId));
      if (status) conditions.push(eq(carrierInvoices.status, status));
      const where = and(...conditions);

      const [rows, [{ count }], [summary]] = await Promise.all([
        app.db
          .select({ inv: carrierInvoices, carrierName: carriers.name, shipmentNumber: shipments.number })
          .from(carrierInvoices)
          .innerJoin(carriers, eq(carrierInvoices.carrierId, carriers.id))
          .leftJoin(shipments, eq(carrierInvoices.shipmentId, shipments.id))
          .where(where)
          .orderBy(desc(carrierInvoices.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db.select({ count: sql<number>`count(*)::int` }).from(carrierInvoices).where(where),
        app.db
          .select({
            pending: sql<number>`count(*) filter (where ${carrierInvoices.status} = 'pending')::int`,
            matched: sql<number>`count(*) filter (where ${carrierInvoices.status} = 'matched')::int`,
            discrepancy: sql<number>`count(*) filter (where ${carrierInvoices.status} = 'discrepancy')::int`,
            totalVariance: sql<number>`coalesce(sum(${carrierInvoices.variance}) filter (where ${carrierInvoices.status} = 'discrepancy'), 0)`,
          })
          .from(carrierInvoices)
          .where(eq(carrierInvoices.tenantId, req.user.tid)),
      ]);
      return {
        items: rows.map((r) => toDto(r.inv, r.carrierName, r.shipmentNumber)),
        total: count,
        page,
        pageSize,
        summary: {
          pending: summary.pending,
          matched: summary.matched,
          discrepancy: summary.discrepancy,
          totalVariance: Math.round(summary.totalVariance * 100) / 100,
        },
      };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("costs:write"),
      schema: {
        body: carrierInvoiceCreateSchema,
        response: { 201: z.object({ invoice: carrierInvoiceDtoSchema }) },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const [carrier] = await app.db
        .select()
        .from(partners)
        .where(
          and(
            eq(partners.id, body.carrierId),
            eq(partners.tenantId, req.user.tid),
            eq(partners.active, true),
          ),
        );
      if (!carrier || !carrier.types.includes("carrier")) {
        throw badRequest("Transportadora não encontrada");
      }

      let shipment: typeof shipments.$inferSelect | null = null;
      if (body.shipmentId) {
        const [s] = await app.db
          .select()
          .from(shipments)
          .where(and(eq(shipments.id, body.shipmentId), eq(shipments.tenantId, req.user.tid)));
        if (!s) throw badRequest("Expedição não encontrada");
        shipment = s;
      }

      // Esperado = soma dos custos de frete na expedição (na moeda da fatura)
      let expectedAmount: number | null = null;
      if (shipment) {
        const [{ total }] = await app.db
          .select({ total: sql<number>`coalesce(sum(${shipmentCosts.amount}), 0)` })
          .from(shipmentCosts)
          .where(
            and(
              eq(shipmentCosts.shipmentId, shipment.id),
              eq(shipmentCosts.type, "freight"),
              eq(shipmentCosts.currency, body.currency),
            ),
          );
        expectedAmount = total > 0 ? Math.round(total * 100) / 100 : null;
      }
      const variance = expectedAmount != null ? Math.round((body.amount - expectedAmount) * 100) / 100 : null;
      const status =
        variance == null
          ? ("pending" as const)
          : Math.abs(variance) <= MATCH_TOLERANCE
            ? ("matched" as const)
            : ("discrepancy" as const);

      const [inv] = await app.db
        .insert(carrierInvoices)
        .values({
          tenantId: req.user.tid,
          carrierId: body.carrierId,
          shipmentId: body.shipmentId ?? null,
          invoiceNumber: body.invoiceNumber,
          amount: body.amount,
          currency: body.currency,
          expectedAmount,
          variance,
          status,
          issuedAt: body.issuedAt ?? null,
          note: body.note ?? null,
          createdBy: req.user.sub,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "freight_invoices.created",
        entity: "carrier_invoice",
        entityId: inv.id,
        metadata: { invoiceNumber: inv.invoiceNumber, amount: inv.amount, status },
        ip: req.ip,
      });
      return reply
        .code(201)
        .send({ invoice: toDto(inv, carrier.name, shipment?.number ?? null) });
    },
  );
};

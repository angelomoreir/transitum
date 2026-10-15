import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  listOrdersQuerySchema,
  orderCreateSchema,
  orderDetailDtoSchema,
  orderDtoSchema,
  orderUpdateSchema,
} from "@blujay/shared";
import { z } from "zod";
import { orderLines, orders, partners, shipments } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { notifyTenant } from "../lib/notify.js";
import { nextNumber } from "../lib/sequences.js";

const listResponse = z.object({
  items: z.array(orderDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

type OrderRow = typeof orders.$inferSelect;

function toDto(o: OrderRow, customerName = "") {
  return {
    id: o.id,
    tenantId: o.tenantId,
    number: o.number,
    status: o.status,
    customerId: o.customerId,
    customerName,
    requestedDate: o.requestedDate ?? null,
    notes: o.notes ?? null,
    deliveryLine1: o.deliveryLine1 ?? null,
    deliveryCity: o.deliveryCity ?? null,
    deliveryPostalCode: o.deliveryPostalCode ?? null,
    deliveryCountry: o.deliveryCountry ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

const ORDER_TRANSITIONS: Record<string, string[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["cancelled"],
  cancelled: [],
};

export const orderRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      preHandler: app.requirePermission("orders:read"),
      schema: { querystring: listOrdersQuerySchema, response: { 200: listResponse } },
    },
    async (req) => {
      const { page, pageSize, q, status, customerId } = req.query;
      const conditions = [eq(orders.tenantId, req.user.tid)];
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(
          or(ilike(orders.number, pattern), ilike(partners.name, pattern))!,
        );
      }
      if (status) conditions.push(eq(orders.status, status));
      if (customerId) conditions.push(eq(orders.customerId, customerId));
      const where = and(...conditions);

      const [items, [{ count }]] = await Promise.all([
        app.db
          .select({ order: orders, customerName: partners.name })
          .from(orders)
          .innerJoin(partners, eq(orders.customerId, partners.id))
          .where(where)
          .orderBy(desc(orders.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(orders)
          .innerJoin(partners, eq(orders.customerId, partners.id))
          .where(where),
      ]);
      return {
        items: items.map((r) => toDto(r.order, r.customerName)),
        total: count,
        page,
        pageSize,
      };
    },
  );

  app.get(
    "/:id",
    {
      preHandler: app.requirePermission("orders:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ order: orderDetailDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await app.db
        .select({ order: orders, customerName: partners.name })
        .from(orders)
        .innerJoin(partners, eq(orders.customerId, partners.id))
        .where(and(eq(orders.id, req.params.id), eq(orders.tenantId, req.user.tid)));
      if (!row) throw notFound("Encomenda não encontrada");

      const [lines, linkedShipments] = await Promise.all([
        app.db
          .select()
          .from(orderLines)
          .where(eq(orderLines.orderId, row.order.id))
          .orderBy(orderLines.lineNo),
        app.db
          .select({ id: shipments.id, number: shipments.number, status: shipments.status })
          .from(shipments)
          .where(eq(shipments.orderId, row.order.id)),
      ]);
      return {
        order: {
          ...toDto(row.order, row.customerName),
          lines: lines.map((l) => ({
            id: l.id,
            lineNo: l.lineNo,
            description: l.description,
            quantity: l.quantity,
            weightKg: l.weightKg ?? null,
          })),
          shipments: linkedShipments,
        },
      };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("orders:write"),
      schema: {
        body: orderCreateSchema,
        response: { 201: z.object({ order: orderDetailDtoSchema }) },
      },
    },
    async (req, reply) => {
      const body = req.body;
      // Cliente tem de pertencer ao tenant e ser customer
      const [customer] = await app.db
        .select()
        .from(partners)
        .where(
          and(
            eq(partners.id, body.customerId),
            eq(partners.tenantId, req.user.tid),
            eq(partners.active, true),
          ),
        );
      if (!customer) throw badRequest("Cliente não encontrado");
      if (!customer.types.includes("customer")) {
        throw badRequest("O parceiro selecionado não é um cliente");
      }

      const number = await nextNumber(app.db, req.user.tid, "order");
      const [order] = await app.db
        .insert(orders)
        .values({
          tenantId: req.user.tid,
          number,
          customerId: body.customerId,
          requestedDate: body.requestedDate || null,
          notes: body.notes ?? null,
          deliveryLine1: body.deliveryLine1 ?? null,
          deliveryCity: body.deliveryCity ?? null,
          deliveryPostalCode: body.deliveryPostalCode ?? null,
          deliveryCountry: body.deliveryCountry ?? null,
          createdBy: req.user.sub,
        })
        .returning();
      const lines = await app.db
        .insert(orderLines)
        .values(
          body.lines.map((l, i) => ({
            tenantId: req.user.tid,
            orderId: order.id,
            lineNo: i + 1,
            description: l.description,
            quantity: l.quantity,
            weightKg: l.weightKg ?? null,
          })),
        )
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "orders.created",
        entity: "order",
        entityId: order.id,
        metadata: { number, customerId: body.customerId },
        ip: req.ip,
      });
      return reply.code(201).send({
        order: {
          ...toDto(order, customer.name),
          lines: lines.map((l) => ({
            id: l.id,
            lineNo: l.lineNo,
            description: l.description,
            quantity: l.quantity,
            weightKg: l.weightKg ?? null,
          })),
          shipments: [],
        },
      });
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("orders:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: orderUpdateSchema,
        response: { 200: z.object({ order: orderDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await app.db
        .select({ order: orders, customerName: partners.name })
        .from(orders)
        .innerJoin(partners, eq(orders.customerId, partners.id))
        .where(and(eq(orders.id, req.params.id), eq(orders.tenantId, req.user.tid)));
      if (!row) throw notFound("Encomenda não encontrada");

      if (req.body.status) {
        const allowed = ORDER_TRANSITIONS[row.order.status] ?? [];
        if (!allowed.includes(req.body.status)) {
          throw badRequest(
            `Transição inválida: ${row.order.status} → ${req.body.status}`,
          );
        }
      }
      const [updated] = await app.db
        .update(orders)
        .set({
          status: req.body.status,
          requestedDate: req.body.requestedDate === null ? null : (req.body.requestedDate ?? undefined),
          notes: req.body.notes === null ? null : (req.body.notes ?? undefined),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, row.order.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: req.body.status ? "orders.status_changed" : "orders.updated",
        entity: "order",
        entityId: updated.id,
        metadata: req.body,
        ip: req.ip,
      });
      if (req.body.status === "confirmed") {
        await notifyTenant(app.db, {
          tenantId: req.user.tid,
          trigger: "order.confirmed",
          title: `Encomenda ${updated.number} confirmada`,
          link: `/orders/${updated.id}`,
        });
      }
      return { order: toDto(updated, row.customerName) };
    },
  );
};

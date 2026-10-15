import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  listShipmentsQuerySchema,
  shipmentCostCreateSchema,
  shipmentCostDtoSchema,
  shipmentCreateSchema,
  shipmentDetailDtoSchema,
  shipmentDtoSchema,
  shipmentEventCreateSchema,
  shipmentEventDtoSchema,
  shipmentStatusUpdateSchema,
  shipmentUpdateSchema,
  SHIPMENT_TRANSITIONS,
  type ShipmentStatus,
} from "@blujay/shared";
import { z } from "zod";
import {
  orders,
  partners,
  shipmentCosts,
  shipmentEvents,
  shipments,
  users,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { notifyTenant } from "../lib/notify.js";
import { nextNumber } from "../lib/sequences.js";
import type { DB } from "../db/client.js";

const listResponse = z.object({
  items: z.array(shipmentDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

type ShipmentRow = typeof shipments.$inferSelect;

function toDto(
  s: ShipmentRow,
  names: { customerName?: string | null; carrierName?: string | null; orderNumber?: string | null } = {},
) {
  return {
    id: s.id,
    tenantId: s.tenantId,
    number: s.number,
    status: s.status,
    customerId: s.customerId,
    customerName: names.customerName ?? "",
    carrierId: s.carrierId ?? null,
    carrierName: names.carrierName ?? null,
    orderId: s.orderId ?? null,
    orderNumber: names.orderNumber ?? null,
    pickupAddress: {
      line1: s.pickupLine1,
      city: s.pickupCity,
      postalCode: s.pickupPostalCode,
      country: s.pickupCountry,
    },
    deliveryAddress: {
      line1: s.deliveryLine1,
      city: s.deliveryCity,
      postalCode: s.deliveryPostalCode,
      country: s.deliveryCountry,
    },
    plannedPickupAt: s.plannedPickupAt?.toISOString() ?? null,
    plannedDeliveryAt: s.plannedDeliveryAt?.toISOString() ?? null,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
    totalWeightKg: s.totalWeightKg ?? null,
    packages: s.packages ?? null,
    notes: s.notes ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

async function assertPartner(
  db: DB,
  tenantId: string,
  id: string,
  requiredType: "customer" | "carrier",
): Promise<typeof partners.$inferSelect> {
  const [p] = await db
    .select()
    .from(partners)
    .where(and(eq(partners.id, id), eq(partners.tenantId, tenantId), eq(partners.active, true)));
  if (!p) throw badRequest("Parceiro não encontrado");
  if (!p.types.includes(requiredType)) {
    throw badRequest(
      requiredType === "customer"
        ? "O parceiro selecionado não é um cliente"
        : "O parceiro selecionado não é uma transportadora",
    );
  }
  return p;
}

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft: "Rascunho",
  planned: "Planeada",
  in_transit: "Em trânsito",
  delivered: "Entregue",
  cancelled: "Cancelada",
};

export const shipmentRoutes: FastifyPluginAsyncZod = async (app) => {
  const carriers = alias(partners, "carriers");

  const baseQuery = () =>
    app.db
      .select({
        shipment: shipments,
        customerName: partners.name,
        carrierName: carriers.name,
        orderNumber: orders.number,
      })
      .from(shipments)
      .innerJoin(partners, eq(shipments.customerId, partners.id))
      .leftJoin(carriers, eq(shipments.carrierId, carriers.id))
      .leftJoin(orders, eq(shipments.orderId, orders.id));

  app.get(
    "/",
    {
      preHandler: app.requirePermission("shipments:read"),
      schema: { querystring: listShipmentsQuerySchema, response: { 200: listResponse } },
    },
    async (req) => {
      const { page, pageSize, q, status, customerId, carrierId } = req.query;
      const conditions = [eq(shipments.tenantId, req.user.tid)];
      if (status) conditions.push(eq(shipments.status, status));
      if (customerId) conditions.push(eq(shipments.customerId, customerId));
      if (carrierId) conditions.push(eq(shipments.carrierId, carrierId));
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(
          or(ilike(shipments.number, pattern), ilike(partners.name, pattern))!,
        );
      }
      const where = and(...conditions);

      const [items, [{ count }]] = await Promise.all([
        baseQuery()
          .where(where)
          .orderBy(desc(shipments.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(shipments)
          .innerJoin(partners, eq(shipments.customerId, partners.id))
          .where(where),
      ]);
      return {
        items: items.map((r) =>
          toDto(r.shipment, {
            customerName: r.customerName,
            carrierName: r.carrierName,
            orderNumber: r.orderNumber,
          }),
        ),
        total: count,
        page,
        pageSize,
      };
    },
  );

  app.get(
    "/:id",
    {
      preHandler: app.requirePermission("shipments:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ shipment: shipmentDetailDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await baseQuery().where(
        and(eq(shipments.id, req.params.id), eq(shipments.tenantId, req.user.tid)),
      );
      if (!row) throw notFound("Expedição não encontrada");
      const [events, costs] = await Promise.all([
        app.db
          .select({
            id: shipmentEvents.id,
            type: shipmentEvents.type,
            status: shipmentEvents.status,
            description: shipmentEvents.description,
            location: shipmentEvents.location,
            occurredAt: shipmentEvents.occurredAt,
            actorName: users.name,
          })
          .from(shipmentEvents)
          .leftJoin(users, eq(shipmentEvents.createdBy, users.id))
          .where(eq(shipmentEvents.shipmentId, row.shipment.id))
          .orderBy(asc(shipmentEvents.occurredAt)),
        app.db
          .select()
          .from(shipmentCosts)
          .where(eq(shipmentCosts.shipmentId, row.shipment.id))
          .orderBy(asc(shipmentCosts.createdAt)),
      ]);
      return {
        shipment: {
          ...toDto(row.shipment, {
            customerName: row.customerName,
            carrierName: row.carrierName,
            orderNumber: row.orderNumber,
          }),
          events: events.map((e) => ({
            id: e.id,
            type: e.type,
            status: e.status ?? null,
            description: e.description,
            location: e.location ?? null,
            actorName: e.actorName ?? null,
            occurredAt: e.occurredAt.toISOString(),
          })),
          costs: costs.map((c) => ({
            id: c.id,
            type: c.type,
            description: c.description,
            amount: c.amount,
            currency: c.currency,
            createdAt: c.createdAt.toISOString(),
          })),
          totalCost: costs.reduce((sum, c) => sum + c.amount, 0),
        },
      };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("shipments:write"),
      schema: {
        body: shipmentCreateSchema,
        response: { 201: z.object({ shipment: shipmentDetailDtoSchema }) },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const customer = await assertPartner(app.db, req.user.tid, body.customerId, "customer");
      let carrierName: string | null = null;
      if (body.carrierId) {
        carrierName = (await assertPartner(app.db, req.user.tid, body.carrierId, "carrier")).name;
      }
      let orderNumber: string | null = null;
      if (body.orderId) {
        const [order] = await app.db
          .select()
          .from(orders)
          .where(and(eq(orders.id, body.orderId), eq(orders.tenantId, req.user.tid)));
        if (!order) throw badRequest("Encomenda não encontrada");
        orderNumber = order.number;
      }

      const number = await nextNumber(app.db, req.user.tid, "shipment");
      const [shipment] = await app.db
        .insert(shipments)
        .values({
          tenantId: req.user.tid,
          number,
          orderId: body.orderId ?? null,
          customerId: body.customerId,
          carrierId: body.carrierId ?? null,
          pickupLine1: body.pickupAddress.line1,
          pickupCity: body.pickupAddress.city,
          pickupPostalCode: body.pickupAddress.postalCode,
          pickupCountry: body.pickupAddress.country,
          deliveryLine1: body.deliveryAddress.line1,
          deliveryCity: body.deliveryAddress.city,
          deliveryPostalCode: body.deliveryAddress.postalCode,
          deliveryCountry: body.deliveryAddress.country,
          plannedPickupAt: body.plannedPickupAt ? new Date(body.plannedPickupAt) : null,
          plannedDeliveryAt: body.plannedDeliveryAt ? new Date(body.plannedDeliveryAt) : null,
          totalWeightKg: body.totalWeightKg ?? null,
          packages: body.packages ?? null,
          notes: body.notes ?? null,
          createdBy: req.user.sub,
        })
        .returning();
      const [event] = await app.db
        .insert(shipmentEvents)
        .values({
          tenantId: req.user.tid,
          shipmentId: shipment.id,
          type: "created",
          status: "draft",
          description: `Expedição ${number} criada`,
          createdBy: req.user.sub,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "shipments.created",
        entity: "shipment",
        entityId: shipment.id,
        metadata: { number },
        ip: req.ip,
      });
      return reply.code(201).send({
        shipment: {
          ...toDto(shipment, { customerName: customer.name, carrierName, orderNumber }),
          events: [
            {
              id: event.id,
              type: event.type,
              status: event.status,
              description: event.description,
              location: event.location ?? null,
              actorName: req.user.name,
              occurredAt: event.occurredAt.toISOString(),
            },
          ],
          costs: [],
          totalCost: 0,
        },
      });
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("shipments:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: shipmentUpdateSchema,
        response: { 200: z.object({ shipment: shipmentDtoSchema }) },
      },
    },
    async (req) => {
      const [target] = await app.db
        .select()
        .from(shipments)
        .where(and(eq(shipments.id, req.params.id), eq(shipments.tenantId, req.user.tid)));
      if (!target) throw notFound("Expedição não encontrada");
      if (["delivered", "cancelled"].includes(target.status)) {
        throw badRequest("Não é possível editar uma expedição entregue ou cancelada");
      }
      if (req.body.carrierId) {
        await assertPartner(app.db, req.user.tid, req.body.carrierId, "carrier");
      }
      const [updated] = await app.db
        .update(shipments)
        .set({
          carrierId:
            req.body.carrierId === null ? null : (req.body.carrierId ?? undefined),
          plannedPickupAt:
            req.body.plannedPickupAt === null
              ? null
              : req.body.plannedPickupAt
                ? new Date(req.body.plannedPickupAt)
                : undefined,
          plannedDeliveryAt:
            req.body.plannedDeliveryAt === null
              ? null
              : req.body.plannedDeliveryAt
                ? new Date(req.body.plannedDeliveryAt)
                : undefined,
          totalWeightKg:
            req.body.totalWeightKg === null ? null : (req.body.totalWeightKg ?? undefined),
          packages: req.body.packages === null ? null : (req.body.packages ?? undefined),
          notes: req.body.notes === null ? null : (req.body.notes ?? undefined),
          updatedAt: new Date(),
        })
        .where(eq(shipments.id, target.id))
        .returning();
      return { shipment: toDto(updated) };
    },
  );

  // Transições de estado com validação + evento automático
  app.post(
    "/:id/status",
    {
      preHandler: app.requirePermission("shipments:status"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: shipmentStatusUpdateSchema,
        response: { 200: z.object({ shipment: shipmentDtoSchema, event: shipmentEventDtoSchema }) },
      },
    },
    async (req) => {
      const [target] = await app.db
        .select()
        .from(shipments)
        .where(and(eq(shipments.id, req.params.id), eq(shipments.tenantId, req.user.tid)));
      if (!target) throw notFound("Expedição não encontrada");

      const next = req.body.status;
      const allowed = SHIPMENT_TRANSITIONS[target.status as ShipmentStatus] ?? [];
      if (!allowed.includes(next)) {
        throw badRequest(
          `Transição inválida: ${STATUS_LABELS[target.status as ShipmentStatus]} → ${STATUS_LABELS[next]}`,
        );
      }

      const [updated] = await app.db
        .update(shipments)
        .set({
          status: next,
          deliveredAt: next === "delivered" ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(shipments.id, target.id))
        .returning();

      const [event] = await app.db
        .insert(shipmentEvents)
        .values({
          tenantId: req.user.tid,
          shipmentId: target.id,
          type: "status",
          status: next,
          description: req.body.note ?? `Estado: ${STATUS_LABELS[next]}`,
          createdBy: req.user.sub,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "shipments.status_changed",
        entity: "shipment",
        entityId: target.id,
        metadata: { from: target.status, to: next },
        ip: req.ip,
      });
      await notifyTenant(app.db, {
        tenantId: req.user.tid,
        trigger: "shipment.status_changed",
        title: `Expedição ${target.number}: ${STATUS_LABELS[next]}`,
        link: `/shipments/${target.id}`,
      });
      if (next === "delivered") {
        await notifyTenant(app.db, {
          tenantId: req.user.tid,
          trigger: "shipment.delivered",
          title: `Expedição ${target.number} entregue`,
          link: `/shipments/${target.id}`,
        });
      }
      return {
        shipment: toDto(updated),
        event: {
          id: event.id,
          type: event.type,
          status: event.status,
          description: event.description,
          location: event.location ?? null,
          actorName: req.user.name,
          occurredAt: event.occurredAt.toISOString(),
        },
      };
    },
  );

  // Evento/nota manual na timeline
  app.post(
    "/:id/events",
    {
      preHandler: app.requirePermission("shipments:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: shipmentEventCreateSchema,
        response: { 201: z.object({ event: shipmentEventDtoSchema }) },
      },
    },
    async (req, reply) => {
      const [target] = await app.db
        .select({ id: shipments.id })
        .from(shipments)
        .where(and(eq(shipments.id, req.params.id), eq(shipments.tenantId, req.user.tid)));
      if (!target) throw notFound("Expedição não encontrada");
      const [event] = await app.db
        .insert(shipmentEvents)
        .values({
          tenantId: req.user.tid,
          shipmentId: target.id,
          type: "note",
          description: req.body.description,
          location: req.body.location ?? null,
          createdBy: req.user.sub,
        })
        .returning();
      return reply.code(201).send({
        event: {
          id: event.id,
          type: event.type,
          status: event.status ?? null,
          description: event.description,
          location: event.location ?? null,
          actorName: req.user.name,
          occurredAt: event.occurredAt.toISOString(),
        },
      });
    },
  );

  // ---- Custos da expedição ----

  app.post(
    "/:id/costs",
    {
      preHandler: app.requirePermission("costs:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: shipmentCostCreateSchema,
        response: { 201: z.object({ cost: shipmentCostDtoSchema }) },
      },
    },
    async (req, reply) => {
      const [target] = await app.db
        .select({ id: shipments.id, status: shipments.status })
        .from(shipments)
        .where(and(eq(shipments.id, req.params.id), eq(shipments.tenantId, req.user.tid)));
      if (!target) throw notFound("Expedição não encontrada");
      if (target.status === "cancelled") {
        throw badRequest("Não é possível adicionar custos a uma expedição cancelada");
      }
      const [cost] = await app.db
        .insert(shipmentCosts)
        .values({
          tenantId: req.user.tid,
          shipmentId: target.id,
          type: req.body.type,
          description: req.body.description,
          amount: req.body.amount,
          currency: req.body.currency,
          createdBy: req.user.sub,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "costs.created",
        entity: "shipment_cost",
        entityId: cost.id,
        metadata: { shipmentId: target.id, amount: cost.amount, currency: cost.currency },
        ip: req.ip,
      });
      return reply.code(201).send({
        cost: {
          id: cost.id,
          type: cost.type,
          description: cost.description,
          amount: cost.amount,
          currency: cost.currency,
          createdAt: cost.createdAt.toISOString(),
        },
      });
    },
  );

  app.delete(
    "/:id/costs/:costId",
    {
      preHandler: app.requirePermission("costs:write"),
      schema: {
        params: z.object({ id: z.string().uuid(), costId: z.string().uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const [cost] = await app.db
        .select()
        .from(shipmentCosts)
        .where(
          and(
            eq(shipmentCosts.id, req.params.costId),
            eq(shipmentCosts.shipmentId, req.params.id),
            eq(shipmentCosts.tenantId, req.user.tid),
          ),
        );
      if (!cost) throw notFound("Custo não encontrado");
      await app.db.delete(shipmentCosts).where(eq(shipmentCosts.id, cost.id));
      return { ok: true as const };
    },
  );
};

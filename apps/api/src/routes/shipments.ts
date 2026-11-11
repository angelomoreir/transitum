import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
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
  type ShipmentLineInput,
} from "@transitum/shared";
import { z } from "zod";
import {
  customsItems,
  items,
  orderLines,
  orders,
  partners,
  proofsOfDelivery,
  routePositions,
  routeStops,
  shipmentCosts,
  shipmentEvents,
  shipmentLines,
  shipments,
  transportDocuments,
  users,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { nextNumber } from "../lib/sequences.js";
import { costToDto, shipmentToDto, transportDocToDto } from "../lib/dto.js";
import { routeKm } from "../lib/routing.js";
import { changeShipmentStatus } from "../lib/shipment-flow.js";
import type { DB } from "../db/client.js";

const listResponse = z.object({
  items: z.array(shipmentDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

type ShipmentRow = typeof shipments.$inferSelect;

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

/**
 * Linhas da expedição: explícitas (com orderLineId ou livres) ou, com orderId,
 * todas as quantidades pendentes da encomenda. Atualiza shippedQty na encomenda.
 */
async function resolveShipmentLines(
  db: DB,
  tenantId: string,
  shipmentId: string,
  orderId: string | null,
  input: ShipmentLineInput[] | undefined,
) {
  const orderLineIds = (input ?? []).map((l) => l.orderLineId).filter((v): v is string => !!v);
  const olRows = orderLineIds.length
    ? await db
        .select()
        .from(orderLines)
        .where(and(eq(orderLines.tenantId, tenantId), inArray(orderLines.id, orderLineIds)))
    : [];
  const olMap = new Map(olRows.map((l) => [l.id, l]));

  let lines: (typeof shipmentLines.$inferInsert)[];
  if (input?.length) {
    lines = input.map((l, i) => {
      const ol = l.orderLineId ? olMap.get(l.orderLineId) : undefined;
      if (l.orderLineId && !ol) throw badRequest("Linha de encomenda não encontrada");
      if (ol) {
        if (!orderId || ol.orderId !== orderId) {
          throw badRequest("A linha não pertence à encomenda da expedição");
        }
        const remaining = ol.quantity - ol.shippedQty;
        if (l.quantity > remaining) {
          throw badRequest(`Quantidade excede o pendente na linha "${ol.description}" (${remaining})`);
        }
      }
      const scaledWeight =
        l.weightKg ?? (ol?.weightKg != null && ol.quantity > 0 ? (ol.weightKg * l.quantity) / ol.quantity : null);
      return {
        tenantId,
        shipmentId,
        lineNo: i + 1,
        orderLineId: ol?.id ?? null,
        itemId: ol?.itemId ?? null,
        description: l.description || ol!.description,
        quantity: l.quantity,
        unit: l.unit ?? "UN",
        weightKg: scaledWeight,
        unitPrice: l.unitPrice ?? ol?.unitPrice ?? null,
      };
    });
  } else if (orderId) {
    const pending = await db
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, orderId))
      .orderBy(orderLines.lineNo);
    lines = pending
      .filter((l) => l.quantity - l.shippedQty > 0)
      .map((l, i) => {
        const qty = l.quantity - l.shippedQty;
        return {
          tenantId,
          shipmentId,
          lineNo: i + 1,
          orderLineId: l.id,
          itemId: l.itemId,
          description: l.description,
          quantity: qty,
          unit: "UN",
          weightKg: l.weightKg != null && l.quantity > 0 ? (l.weightKg * qty) / l.quantity : null,
          unitPrice: l.unitPrice,
        };
      });
  } else {
    lines = [];
  }

  if (lines.length) {
    await db.insert(shipmentLines).values(lines);
    for (const l of lines) {
      if (l.orderLineId) {
        await db
          .update(orderLines)
          .set({ shippedQty: sql`${orderLines.shippedQty} + ${l.quantity}` })
          .where(eq(orderLines.id, l.orderLineId));
      }
    }
  }
  return lines;
}

interface ShipmentAddresses {
  pickupAddress: { line1: string; city: string; postalCode: string; country: string };
  deliveryAddress: { line1: string; city: string; postalCode: string; country: string };
}

/** Geocodifica origem/destino e estima a distância por estrada. */
async function geocodeShipment(
  app: FastifyInstance,
  s: ShipmentAddresses,
  distanceKm: number | null,
) {
  const [pickup, delivery] = await Promise.all([
    app.geocoder.geocode(s.pickupAddress),
    app.geocoder.geocode(s.deliveryAddress),
  ]);
  return {
    pickupLat: pickup?.lat ?? null,
    pickupLng: pickup?.lng ?? null,
    deliveryLat: delivery?.lat ?? null,
    deliveryLng: delivery?.lng ?? null,
    // Distância rodoviária real (OSRM/cache) com fallback linha reta × fator
    distanceKm:
      distanceKm ?? (pickup && delivery ? await routeKm(app.db, pickup, delivery, app.log) : null),
  };
}

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

  const detailExtras = async (s: ShipmentRow) => {
    const [events, costs, customs, lines, docs, proofs, [pos]] = await Promise.all([
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
        .where(eq(shipmentEvents.shipmentId, s.id))
        .orderBy(asc(shipmentEvents.occurredAt)),
      app.db
        .select()
        .from(shipmentCosts)
        .where(eq(shipmentCosts.shipmentId, s.id))
        .orderBy(asc(shipmentCosts.createdAt)),
      app.db
        .select()
        .from(customsItems)
        .where(eq(customsItems.shipmentId, s.id))
        .orderBy(asc(customsItems.createdAt)),
      app.db
        .select({ line: shipmentLines, sku: items.sku })
        .from(shipmentLines)
        .leftJoin(items, eq(shipmentLines.itemId, items.id))
        .where(eq(shipmentLines.shipmentId, s.id))
        .orderBy(asc(shipmentLines.lineNo)),
      app.db
        .select()
        .from(transportDocuments)
        .where(and(eq(transportDocuments.shipmentId, s.id), eq(transportDocuments.tenantId, s.tenantId)))
        .orderBy(desc(transportDocuments.createdAt)),
      app.db
        .select({ pod: proofsOfDelivery, stopType: routeStops.type, capturedByName: users.name })
        .from(proofsOfDelivery)
        .innerJoin(routeStops, eq(proofsOfDelivery.stopId, routeStops.id))
        .leftJoin(users, eq(proofsOfDelivery.capturedBy, users.id))
        .where(eq(proofsOfDelivery.shipmentId, s.id)),
      app.db
        .select({
          lat: routePositions.lat,
          lng: routePositions.lng,
          accuracyM: routePositions.accuracyM,
          recordedAt: routePositions.recordedAt,
        })
        .from(routePositions)
        .innerJoin(
          routeStops,
          and(eq(routeStops.routeId, routePositions.routeId), eq(routeStops.shipmentId, s.id)),
        )
        .where(eq(routePositions.tenantId, s.tenantId))
        .orderBy(desc(routePositions.recordedAt))
        .limit(1),
    ]);
    return {
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status ?? null,
        description: e.description,
        location: e.location ?? null,
        actorName: e.actorName ?? null,
        occurredAt: e.occurredAt.toISOString(),
      })),
      costs: costs.map(costToDto),
      customsItems: customs.map((c) => ({
        id: c.id,
        description: c.description,
        hsCode: c.hsCode ?? null,
        originCountry: c.originCountry ?? null,
        quantity: c.quantity,
        weightKg: c.weightKg ?? null,
        value: c.value ?? null,
        currency: c.currency,
      })),
      lines: lines.map(({ line, sku }) => ({
        id: line.id,
        lineNo: line.lineNo,
        orderLineId: line.orderLineId ?? null,
        itemId: line.itemId ?? null,
        sku: sku ?? null,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        weightKg: line.weightKg ?? null,
        unitPrice: line.unitPrice ?? null,
      })),
      transportDocuments: docs.map(transportDocToDto),
      proofs: proofs.map(({ pod, stopType, capturedByName }) => ({
        id: pod.id,
        stopId: pod.stopId,
        stopType,
        recipientName: pod.recipientName,
        signatureDocId: pod.signatureDocId ?? null,
        photoDocId: pod.photoDocId ?? null,
        coords: pod.lat != null && pod.lng != null ? { lat: pod.lat, lng: pod.lng } : null,
        note: pod.note ?? null,
        capturedByName: capturedByName ?? null,
        capturedAt: pod.capturedAt.toISOString(),
      })),
      lastPosition: pos
        ? {
            lat: pos.lat,
            lng: pos.lng,
            accuracyM: pos.accuracyM ?? null,
            recordedAt: pos.recordedAt.toISOString(),
          }
        : null,
      totalCost: costs.reduce((sum, c) => sum + c.amount, 0),
    };
  };

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
          or(
            ilike(shipments.number, pattern),
            ilike(partners.name, pattern),
            ilike(shipments.trackingNumber, pattern),
          )!,
        );
      }
      const where = and(...conditions);

      const [items_, [{ count }]] = await Promise.all([
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
        items: items_.map((r) =>
          shipmentToDto(r.shipment, {
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
      return {
        shipment: {
          ...shipmentToDto(row.shipment, {
            customerName: row.customerName,
            carrierName: row.carrierName,
            orderNumber: row.orderNumber,
          }),
          ...(await detailExtras(row.shipment)),
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
        if (order.status === "cancelled") throw badRequest("A encomenda está cancelada");
        orderNumber = order.number;
      }

      const geo = await geocodeShipment(app, body, body.distanceKm ?? null);
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
          incoterm: body.incoterm ?? null,
          notes: body.notes ?? null,
          recipientName: body.recipientName ?? null,
          recipientEmail: body.recipientEmail ?? null,
          recipientPhone: body.recipientPhone ?? null,
          notifyRecipient: body.notifyRecipient,
          trackingToken: randomBytes(20).toString("hex"),
          vehicleRef: body.vehicleRef ?? null,
          ...geo,
          createdBy: req.user.sub,
        })
        .returning();
      const lines = await resolveShipmentLines(app.db, req.user.tid, shipment.id, body.orderId ?? null, body.lines);
      if (!body.totalWeightKg && lines.length) {
        const total = lines.reduce((a, l) => a + (l.weightKg ?? 0), 0);
        if (total > 0) {
          await app.db.update(shipments).set({ totalWeightKg: total }).where(eq(shipments.id, shipment.id));
          shipment.totalWeightKg = total;
        }
      }
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
          ...shipmentToDto(shipment, { customerName: customer.name, carrierName, orderNumber }),
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
          customsItems: [],
          lines: (await detailExtras(shipment)).lines,
          transportDocuments: [],
          proofs: [],
          lastPosition: null,
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
      const opt = <T,>(v: T | null | undefined) => (v === null ? null : (v ?? undefined));
      const [updated] = await app.db
        .update(shipments)
        .set({
          carrierId: opt(req.body.carrierId),
          plannedPickupAt: opt(req.body.plannedPickupAt === null ? null : req.body.plannedPickupAt ? new Date(req.body.plannedPickupAt) : undefined) as never,
          plannedDeliveryAt: opt(req.body.plannedDeliveryAt === null ? null : req.body.plannedDeliveryAt ? new Date(req.body.plannedDeliveryAt) : undefined) as never,
          totalWeightKg: opt(req.body.totalWeightKg),
          packages: opt(req.body.packages),
          incoterm: opt(req.body.incoterm),
          notes: opt(req.body.notes),
          recipientName: opt(req.body.recipientName),
          recipientEmail: opt(req.body.recipientEmail),
          recipientPhone: opt(req.body.recipientPhone),
          notifyRecipient: req.body.notifyRecipient,
          distanceKm: opt(req.body.distanceKm),
          vehicleRef: opt(req.body.vehicleRef),
          updatedAt: new Date(),
        })
        .where(eq(shipments.id, target.id))
        .returning();
      return { shipment: shipmentToDto(updated) };
    },
  );

  // Transição de estado centralizada (stock, eventos, notificações, custo automático)
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

      const { shipment, event } = await changeShipmentStatus(
        app,
        { tenantId: req.user.tid, userId: req.user.sub, name: req.user.name, ip: req.ip },
        target,
        req.body.status,
        { note: req.body.note },
      );
      return {
        shipment: shipmentToDto(shipment),
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
      return reply.code(201).send({ cost: costToDto(cost) });
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

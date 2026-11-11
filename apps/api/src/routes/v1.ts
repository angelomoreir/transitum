import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import {
  carrierEventSchema,
  inboundOrderResponseSchema,
  inboundOrderSchema,
  listOrdersQuerySchema,
  listShipmentsQuerySchema,
  listStockQuerySchema,
  orderCreateSchema,
  orderDetailDtoSchema,
  orderDtoSchema,
  shipmentDtoSchema,
  stockLevelDtoSchema,
} from "@transitum/shared";
import { z } from "zod";
import {
  apiKeys,
  items,
  orderLines,
  orders,
  partners,
  shipmentEvents,
  shipments,
  stockLevels,
  warehouses,
} from "../db/schema.js";
import { hashApiKey } from "../lib/apikeys.js";
import { badRequest, notFound, unauthorized } from "../lib/errors.js";
import { createInboundOrder } from "../lib/inbound.js";
import { nextNumber } from "../lib/sequences.js";
import { orderLineToDto, orderToDto, orderTotal, shipmentToDto } from "../lib/dto.js";
import { changeShipmentStatus } from "../lib/shipment-flow.js";

/**
 * API pública v1 — autenticação por chave de API (`x-api-key: bjk_...`)
 * ou Bearer JWT de utilizador. Âmbito: encomendas e expedições do tenant.
 */

// Rate limit dedicado à API pública (por IP/chave)
const V1_RATE_LIMIT = { max: 120, timeWindow: "1 minute" };

const orderListResponse = z.object({
  items: z.array(orderDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const orderDto = (o: typeof orders.$inferSelect, customerName: string | null, warehouseName: string | null = null) =>
  orderToDto(o, customerName ?? "", warehouseName);

export const publicApiRoutes: FastifyPluginAsyncZod = async (app) => {
  // Auth: x-api-key (tenant da chave) ou Bearer JWT normal
  await app.register(async (scope) => {
    const v1 = scope.withTypeProvider<ZodTypeProvider>();
    v1.addHook("preHandler", async (req) => {
      const key = req.headers["x-api-key"];
      if (typeof key === "string" && key.length > 0) {
        const [row] = await app.db
          .select()
          .from(apiKeys)
          .where(
            and(
              eq(apiKeys.keyHash, hashApiKey(key)),
              eq(apiKeys.active, true),
              or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
            ),
          );
        if (!row) throw unauthorized("Chave de API inválida ou expirada");
        req.user = {
          sub: row.createdBy ?? row.id,
          tid: row.tenantId,
          role: "operator",
          name: `API key ${row.prefix}`,
          email: "",
        };
        // última utilização — best effort, não bloqueia
        void app.db
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, row.id));
        return;
      }
      await req.jwtVerify();
    });

    v1.get(
      "/orders",
      {
        config: { rateLimit: V1_RATE_LIMIT },
        schema: {
          tags: ["Public API"],
          querystring: listOrdersQuerySchema,
          response: { 200: orderListResponse },
        },
      },
      async (req) => {
        const { page, pageSize, q, status, customerId } = req.query;
        const conditions = [eq(orders.tenantId, req.user.tid)];
        if (q) {
          const pattern = `%${q}%`;
          conditions.push(or(ilike(orders.number, pattern), ilike(partners.name, pattern))!);
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
          items: items.map((r) => orderDto(r.order, r.customerName)),
          total: count,
          page,
          pageSize,
        };
      },
    );

    v1.get(
      "/orders/:id",
      {
        config: { rateLimit: V1_RATE_LIMIT },
        schema: {
          tags: ["Public API"],
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
        const lines = await app.db
          .select()
          .from(orderLines)
          .where(eq(orderLines.orderId, row.order.id))
          .orderBy(orderLines.lineNo);
        const itemRows = lines.length
          ? await app.db
              .select({ id: items.id, sku: items.sku, unit: items.unit })
              .from(items)
              .where(inArray(items.id, lines.map((l) => l.itemId).filter((v): v is string => !!v)))
          : [];
        const itemMap = new Map(itemRows.map((i) => [i.id, i]));
        const linked = await app.db
          .select({ id: shipments.id, number: shipments.number, status: shipments.status })
          .from(shipments)
          .where(eq(shipments.orderId, row.order.id));
        const dtos = lines.map((l) => orderLineToDto(l, itemMap.get(l.itemId ?? "") ?? null));
        return {
          order: {
            ...orderDto(row.order, row.customerName),
            lines: dtos,
            totalValue: orderTotal(dtos),
            shipments: linked,
          },
        };
      },
    );

    v1.post(
      "/orders",
      {
        config: { rateLimit: V1_RATE_LIMIT },
        schema: {
          tags: ["Public API"],
          body: orderCreateSchema,
          response: { 201: z.object({ order: orderDtoSchema }) },
        },
      },
      async (req, reply) => {
        const body = req.body;
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
            warehouseId: body.warehouseId ?? null,
            requestedDate: body.requestedDate || null,
            notes: body.notes ?? null,
            deliveryLine1: body.deliveryLine1 ?? null,
            deliveryCity: body.deliveryCity ?? null,
            deliveryPostalCode: body.deliveryPostalCode ?? null,
            deliveryCountry: body.deliveryCountry ?? null,
          })
          .returning();
        await app.db.insert(orderLines).values(
          body.lines.map((l, i) => ({
            tenantId: req.user.tid,
            orderId: order.id,
            lineNo: i + 1,
            itemId: l.itemId ?? null,
            description: l.description ?? "",
            quantity: l.quantity,
            weightKg: l.weightKg ?? null,
            unitPrice: l.unitPrice ?? null,
          })),
        );
        return reply.code(201).send({ order: orderDto(order, customer.name) });
      },
    );

    v1.get(
      "/shipments",
      {
        config: { rateLimit: V1_RATE_LIMIT },
        schema: {
          tags: ["Public API"],
          querystring: listShipmentsQuerySchema,
          response: {
            200: z.object({
              items: z.array(shipmentDtoSchema),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
            }),
          },
        },
      },
      async (req) => {
        const { page, pageSize, q, status, customerId, carrierId } = req.query;
        const conditions = [eq(shipments.tenantId, req.user.tid)];
        if (q) conditions.push(ilike(shipments.number, `%${q}%`));
        if (status) conditions.push(eq(shipments.status, status));
        if (customerId) conditions.push(eq(shipments.customerId, customerId));
        if (carrierId) conditions.push(eq(shipments.carrierId, carrierId));
        const where = and(...conditions);
        const [items, [{ count }]] = await Promise.all([
          app.db
            .select()
            .from(shipments)
            .where(where)
            .orderBy(desc(shipments.createdAt))
            .limit(pageSize)
            .offset((page - 1) * pageSize),
          app.db.select({ count: sql<number>`count(*)::int` }).from(shipments).where(where),
        ]);
        const partnerIds = [
          ...new Set(items.flatMap((s) => [s.customerId, s.carrierId].filter(Boolean) as string[])),
        ];
        const partnerRows = partnerIds.length
          ? await app.db
              .select({ id: partners.id, name: partners.name })
              .from(partners)
              .where(and(eq(partners.tenantId, req.user.tid), or(...partnerIds.map((id) => eq(partners.id, id)))))
          : [];
        const names = new Map(partnerRows.map((p) => [p.id, p.name]));
        const orderIds = [...new Set(items.map((s) => s.orderId).filter(Boolean) as string[])];
        const orderRows = orderIds.length
          ? await app.db
              .select({ id: orders.id, number: orders.number })
              .from(orders)
              .where(and(eq(orders.tenantId, req.user.tid), or(...orderIds.map((id) => eq(orders.id, id)))))
          : [];
        const orderMap = new Map(orderRows.map((o) => [o.id, o.number]));
        return {
          items: items.map((s) =>
            shipmentToDto(s, {
              customerName: names.get(s.customerId),
              carrierName: s.carrierId ? names.get(s.carrierId) : null,
              orderNumber: s.orderId ? orderMap.get(s.orderId) : null,
            }),
          ),
          total: count,
          page,
          pageSize,
        };
      },
    );

    v1.get(
      "/shipments/:id",
      {
        config: { rateLimit: V1_RATE_LIMIT },
        schema: {
          tags: ["Public API"],
          params: z.object({ id: z.string().uuid() }),
          response: { 200: z.object({ shipment: shipmentDtoSchema }) },
        },
      },
      async (req) => {
        const [s] = await app.db
          .select()
          .from(shipments)
          .where(and(eq(shipments.id, req.params.id), eq(shipments.tenantId, req.user.tid)));
        if (!s) throw notFound("Expedição não encontrada");
        const [customer] = await app.db
          .select({ name: partners.name })
          .from(partners)
          .where(eq(partners.id, s.customerId));
        const [carrier] = s.carrierId
          ? await app.db
              .select({ name: partners.name })
              .from(partners)
              .where(eq(partners.id, s.carrierId))
          : [null];
        const [order] = s.orderId
          ? await app.db
              .select({ number: orders.number })
              .from(orders)
              .where(eq(orders.id, s.orderId))
          : [null];
        return {
          shipment: shipmentToDto(s, {
            customerName: customer?.name,
            carrierName: carrier?.name ?? null,
            orderNumber: order?.number ?? null,
          }),
        };
      },
    );

    /**
     * Push de eventos de tracking por transportadora/agregador — localiza a
     * expedição pelo nº de tracking e transita o estado quando aplicável.
     */
    /**
     * Intake EDI/e-commerce — encomenda criada a partir de referências externas.
     * Idempotente por `externalRef`; resolve/cria o cliente por NIF ou nome e
     * os artigos por SKU (SKU desconhecido fica como linha de texto).
     */
    v1.post(
      "/inbound-orders",
      {
        config: { rateLimit: V1_RATE_LIMIT },
        schema: {
          tags: ["Public API"],
          body: inboundOrderSchema,
          response: {
            200: inboundOrderResponseSchema,
            201: inboundOrderResponseSchema,
          },
        },
      },
      async (req, reply) => {
        const body = req.body;

        // Idempotência: mesma externalRef → devolve a encomenda existente
        const [existing] = await app.db
          .select()
          .from(orders)
          .where(
            and(eq(orders.tenantId, req.user.tid), eq(orders.externalRef, body.externalRef)),
          );
        if (existing) {
          return reply.code(200).send({
            order: {
              id: existing.id,
              number: existing.number,
              status: existing.status,
              externalRef: existing.externalRef ?? null,
            },
            duplicate: true,
          });
        }

        const order = await createInboundOrder(app.db, req.user.tid, body, req.user.sub);
        return reply.code(201).send({
          order: {
            id: order.id,
            number: order.number,
            status: order.status,
            externalRef: order.externalRef ?? null,
          },
          duplicate: false,
        });
      },
    );

    /** Níveis de stock por armazém/artigo (consulta para integrações). */
    v1.get(
      "/stock",
      {
        config: { rateLimit: V1_RATE_LIMIT },
        schema: {
          tags: ["Public API"],
          querystring: listStockQuerySchema,
          response: {
            200: z.object({
              items: z.array(stockLevelDtoSchema),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
            }),
          },
        },
      },
      async (req) => {
        const { page, pageSize, warehouseId, itemId, q } = req.query;
        const conditions = [eq(stockLevels.tenantId, req.user.tid)];
        if (warehouseId) conditions.push(eq(stockLevels.warehouseId, warehouseId));
        if (itemId) conditions.push(eq(stockLevels.itemId, itemId));
        if (q) {
          const pattern = `%${q}%`;
          conditions.push(or(ilike(items.sku, pattern), ilike(items.name, pattern))!);
        }
        const where = and(...conditions);
        const [rows, [{ count }]] = await Promise.all([
          app.db
            .select({
              level: stockLevels,
              wh: { code: warehouses.code, name: warehouses.name },
              item: { sku: items.sku, name: items.name, unit: items.unit },
            })
            .from(stockLevels)
            .innerJoin(warehouses, eq(stockLevels.warehouseId, warehouses.id))
            .innerJoin(items, eq(stockLevels.itemId, items.id))
            .where(where)
            .orderBy(items.sku, warehouses.code)
            .limit(pageSize)
            .offset((page - 1) * pageSize),
          app.db
            .select({ count: sql<number>`count(*)::int` })
            .from(stockLevels)
            .innerJoin(items, eq(stockLevels.itemId, items.id))
            .where(where),
        ]);
        return {
          items: rows.map((r) => ({
            warehouseId: r.level.warehouseId,
            warehouseCode: r.wh.code,
            warehouseName: r.wh.name,
            itemId: r.level.itemId,
            sku: r.item.sku,
            itemName: r.item.name,
            unit: r.item.unit,
            onHand: r.level.onHand,
            reserved: r.level.reserved,
            reorderPoint: r.level.reorderPoint ?? null,
          })),
          total: count,
          page,
          pageSize,
        };
      },
    );

    v1.post(
      "/carrier-events",
      {
        config: { rateLimit: V1_RATE_LIMIT },
        schema: {
          tags: ["Public API"],
          body: carrierEventSchema,
          response: { 200: z.object({ shipment: shipmentDtoSchema, matched: z.literal(true) }) },
        },
      },
      async (req) => {
        const e = req.body;
        const [s] = await app.db
          .select()
          .from(shipments)
          .where(and(eq(shipments.tenantId, req.user.tid), eq(shipments.trackingNumber, e.trackingNumber)));
        if (!s) throw notFound("Nenhuma expedição com este número de tracking");

        await app.db.insert(shipmentEvents).values({
          tenantId: req.user.tid,
          shipmentId: s.id,
          type: "carrier",
          description: e.description,
          location: e.location ?? null,
          occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
          createdBy: req.user.sub,
        });

        const act = { tenantId: req.user.tid, userId: req.user.sub, name: req.user.name };
        let current = s;
        if (e.status === "delivered" && s.status === "in_transit") {
          current = (await changeShipmentStatus(app, act, s, "delivered", { source: "transportadora" })).shipment;
        } else if (e.status === "in_transit" && s.status === "planned") {
          current = (await changeShipmentStatus(app, act, s, "in_transit", { source: "transportadora" })).shipment;
        }
        return { shipment: shipmentToDto(current), matched: true as const };
      },
    );
  });
};

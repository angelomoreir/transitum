import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type {
  FastifyPluginAsyncZod,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import {
  listOrdersQuerySchema,
  listShipmentsQuerySchema,
  orderCreateSchema,
  orderDetailDtoSchema,
  orderDtoSchema,
  shipmentDtoSchema,
  type CustomsStatus,
  type Incoterm,
} from "@blujay/shared";
import { z } from "zod";
import {
  apiKeys,
  orderLines,
  orders,
  partners,
  shipments,
} from "../db/schema.js";
import { hashApiKey } from "../lib/apikeys.js";
import { badRequest, notFound, unauthorized } from "../lib/errors.js";
import { nextNumber } from "../lib/sequences.js";

/**
 * API pública v1 — autenticação por chave de API (`x-api-key: bjk_...`)
 * ou Bearer JWT de utilizador. Âmbito: encomendas e expedições do tenant.
 */

const orderListResponse = z.object({
  items: z.array(orderDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const orderDto = (o: typeof orders.$inferSelect, customerName: string | null) => ({
  id: o.id,
  tenantId: o.tenantId,
  number: o.number,
  status: o.status,
  customerId: o.customerId,
  customerName: customerName ?? "",
  requestedDate: o.requestedDate ?? null,
  notes: o.notes ?? null,
  deliveryLine1: o.deliveryLine1 ?? null,
  deliveryCity: o.deliveryCity ?? null,
  deliveryPostalCode: o.deliveryPostalCode ?? null,
  deliveryCountry: o.deliveryCountry ?? null,
  createdAt: o.createdAt.toISOString(),
});

const shipmentDto = (s: typeof shipments.$inferSelect, names: { customer?: string | null; carrier?: string | null; order?: string | null } = {}) => ({
  id: s.id,
  tenantId: s.tenantId,
  number: s.number,
  status: s.status,
  customerId: s.customerId,
  customerName: names.customer ?? "",
  carrierId: s.carrierId ?? null,
  carrierName: names.carrier ?? null,
  orderId: s.orderId ?? null,
  orderNumber: names.order ?? null,
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
  incoterm: (s.incoterm as Incoterm | null) ?? null,
  customsStatus: s.customsStatus as CustomsStatus,
  notes: s.notes ?? null,
  createdAt: s.createdAt.toISOString(),
});

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
          .where(and(eq(apiKeys.keyHash, hashApiKey(key)), eq(apiKeys.active, true)));
        if (!row) throw unauthorized("Chave de API inválida");
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
        const linked = await app.db
          .select({ id: shipments.id, number: shipments.number, status: shipments.status })
          .from(shipments)
          .where(eq(shipments.orderId, row.order.id));
        return {
          order: {
            ...orderDto(row.order, row.customerName),
            lines: lines.map((l) => ({
              id: l.id,
              lineNo: l.lineNo,
              description: l.description,
              quantity: l.quantity,
              weightKg: l.weightKg ?? null,
            })),
            shipments: linked,
          },
        };
      },
    );

    v1.post(
      "/orders",
      {
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
            description: l.description,
            quantity: l.quantity,
            weightKg: l.weightKg ?? null,
          })),
        );
        return reply.code(201).send({ order: orderDto(order, customer.name) });
      },
    );

    v1.get(
      "/shipments",
      {
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
            shipmentDto(s, {
              customer: names.get(s.customerId),
              carrier: s.carrierId ? names.get(s.carrierId) : null,
              order: s.orderId ? orderMap.get(s.orderId) : null,
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
          shipment: shipmentDto(s, {
            customer: customer?.name,
            carrier: carrier?.name ?? null,
            order: order?.number ?? null,
          }),
        };
      },
    );
  });
};

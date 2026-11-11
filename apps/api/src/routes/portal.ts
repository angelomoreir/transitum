import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { portalDtoSchema, portalOrderCreateSchema, portalOrderDtoSchema } from "@transitum/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { items, orderLines, orders, partners, shipments, warehouses } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { nextNumber } from "../lib/sequences.js";
import { notifyTenant } from "../lib/notify.js";

/**
 * Portal do cliente — acesso público pelo token do parceiro
 * (`/portal/<token>` no frontend). Mostra as encomendas e expedições do
 * cliente com ligações de tracking; não expõe dados de outros clientes.
 */
export const portalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/:token",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        params: z.object({ token: z.string().min(20).max(64) }),
        response: { 200: z.object({ portal: portalDtoSchema }) },
      },
    },
    async (req) => {
      const [customer] = await app.db
        .select()
        .from(partners)
        .where(eq(partners.portalToken, req.params.token));
      if (!customer || !customer.active) throw notFound("Portal não encontrado");

      const [orderRows, shipmentRows, lineCounts] = await Promise.all([
        app.db
          .select()
          .from(orders)
          .where(eq(orders.customerId, customer.id))
          .orderBy(desc(orders.createdAt))
          .limit(100),
        app.db
          .select()
          .from(shipments)
          .where(eq(shipments.customerId, customer.id))
          .orderBy(desc(shipments.createdAt))
          .limit(100),
        app.db
          .select({
            orderId: orderLines.orderId,
            cnt: sql<number>`count(*)::int`,
          })
          .from(orderLines)
          .innerJoin(orders, eq(orderLines.orderId, orders.id))
          .where(eq(orders.customerId, customer.id))
          .groupBy(orderLines.orderId),
      ]);
      const linesByOrder = new Map(lineCounts.map((r) => [r.orderId, r.cnt]));
      const orderNumberById = new Map(orderRows.map((o) => [o.id, o.number]));

      return {
        portal: {
          customerName: customer.name,
          orders: orderRows.map((o) => ({
            number: o.number,
            status: o.status,
            requestedDate: o.requestedDate ?? null,
            createdAt: o.createdAt.toISOString(),
            lines: linesByOrder.get(o.id) ?? 0,
          })),
          shipments: shipmentRows.map((s) => ({
            number: s.number,
            status: s.status,
            orderNumber: s.orderId ? (orderNumberById.get(s.orderId) ?? null) : null,
            trackingUrl: s.trackingToken ? `/track/${s.trackingToken}` : null,
            deliveredAt: s.deliveredAt?.toISOString() ?? null,
            createdAt: s.createdAt.toISOString(),
          })),
        },
      };
    },
  );

  /**
   * O próprio cliente cria uma encomenda (rascunho) a partir do portal.
   * O cliente fica sempre associado ao token — não é possível indicar outro.
   * Linhas por SKU resolvem o artigo; SKU desconhecido vira linha de texto.
   */
  app.post(
    "/:token/orders",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        params: z.object({ token: z.string().min(20).max(64) }),
        body: portalOrderCreateSchema,
        response: { 201: z.object({ order: portalOrderDtoSchema }) },
      },
    },
    async (req, reply) => {
      const [customer] = await app.db
        .select()
        .from(partners)
        .where(eq(partners.portalToken, req.params.token));
      if (!customer || !customer.active) throw notFound("Portal não encontrado");
      const tid = customer.tenantId;
      const body = req.body;

      const [wh] = await app.db
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.tenantId, tid), eq(warehouses.active, true)))
        .limit(1);

      const skus = [...new Set(body.lines.map((l) => l.sku).filter((v): v is string => !!v))];
      const itemRows = skus.length
        ? await app.db
            .select()
            .from(items)
            .where(and(eq(items.tenantId, tid), inArray(items.sku, skus)))
        : [];
      const itemBySku = new Map(itemRows.map((i) => [i.sku, i]));
      if (!body.lines.every((l) => l.sku || l.description)) {
        throw badRequest("Cada linha precisa de SKU ou descrição");
      }

      const [order] = await app.db
        .insert(orders)
        .values({
          tenantId: tid,
          number: await nextNumber(app.db, tid, "order"),
          customerId: customer.id,
          warehouseId: wh?.id ?? null,
          requestedDate: body.requestedDate || null,
          notes: body.notes ?? null,
          deliveryLine1: body.deliveryLine1 ?? customer.addressLine1,
          deliveryCity: body.deliveryCity ?? customer.city,
          deliveryPostalCode: body.deliveryPostalCode ?? customer.postalCode,
          deliveryCountry: body.deliveryCountry ?? customer.country,
          externalRef: `portal:${randomUUID()}`,
        })
        .returning();
      await app.db.insert(orderLines).values(
        body.lines.map((l, i) => {
          const item = l.sku ? itemBySku.get(l.sku) : undefined;
          return {
            tenantId: tid,
            orderId: order.id,
            lineNo: i + 1,
            itemId: item?.id ?? null,
            description: l.description ?? (item ? item.name : l.sku ? `[${l.sku}]` : ""),
            quantity: l.quantity,
            weightKg: item?.weightKg != null ? item.weightKg * l.quantity : null,
            unitPrice: l.unitPrice ?? null,
          };
        }),
      );
      await notifyTenant(app.db, {
        tenantId: tid,
        trigger: "order.created",
        title: `Encomenda ${order.number} criada pelo portal (${customer.name})`,
        link: `/orders/${order.id}`,
      });
      return reply.code(201).send({
        order: {
          number: order.number,
          status: order.status,
          requestedDate: order.requestedDate ?? null,
          createdAt: order.createdAt.toISOString(),
          lines: body.lines.length,
        },
      });
    },
  );
};

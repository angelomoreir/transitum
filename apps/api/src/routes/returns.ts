import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  listReturnsQuerySchema,
  returnCreateSchema,
  returnDetailDtoSchema,
  returnDtoSchema,
} from "@transitum/shared";
import { z } from "zod";
import {
  items,
  orders,
  partners,
  returnLines,
  returns,
  warehouseLocations,
  warehouses,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { nextNumber } from "../lib/sequences.js";
import { applyBinDelta, applyStockDelta, recordMovement, returnSerials } from "../lib/stock.js";

const listResponse = z.object({
  items: z.array(returnDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

type Row = typeof returns.$inferSelect;
type LineRow = typeof returnLines.$inferSelect;

function toDto(r: Row, customerName: string, warehouseName: string, orderNumber: string | null) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    customerId: r.customerId,
    customerName,
    orderId: r.orderId ?? null,
    orderNumber,
    warehouseId: r.warehouseId,
    warehouseName,
    reason: r.reason ?? null,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

function lineToDto(l: LineRow, sku: string | null) {
  return {
    id: l.id,
    itemId: l.itemId ?? null,
    sku,
    description: l.description,
    quantity: l.quantity,
    receivedQty: l.receivedQty,
  };
}

export const returnRoutes: FastifyPluginAsyncZod = async (app) => {
  const baseQuery = () =>
    app.db
      .select({
        ret: returns,
        customerName: partners.name,
        warehouseName: warehouses.name,
        orderNumber: orders.number,
      })
      .from(returns)
      .innerJoin(partners, eq(returns.customerId, partners.id))
      .innerJoin(warehouses, eq(returns.warehouseId, warehouses.id))
      .leftJoin(orders, eq(returns.orderId, orders.id));

  const loadDetail = async (tid: string, id: string) => {
    const [row] = await baseQuery().where(
      and(eq(returns.id, id), eq(returns.tenantId, tid)),
    );
    if (!row) throw notFound("Devolução não encontrada");
    const lines = await app.db
      .select({ line: returnLines, sku: items.sku })
      .from(returnLines)
      .leftJoin(items, eq(returnLines.itemId, items.id))
      .where(eq(returnLines.returnId, row.ret.id))
      .orderBy(asc(returnLines.lineNo), asc(returnLines.id));
    return {
      ...toDto(row.ret, row.customerName, row.warehouseName, row.orderNumber),
      lines: lines.map((l) => lineToDto(l.line, l.sku)),
    };
  };

  app.get(
    "/",
    {
      preHandler: app.requirePermission("orders:read"),
      schema: { querystring: listReturnsQuerySchema, response: { 200: listResponse } },
    },
    async (req) => {
      const { page, pageSize, q, status, customerId } = req.query;
      const conditions = [eq(returns.tenantId, req.user.tid)];
      if (status) conditions.push(eq(returns.status, status));
      if (customerId) conditions.push(eq(returns.customerId, customerId));
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(
          or(ilike(returns.number, pattern), ilike(partners.name, pattern))!,
        );
      }
      const where = and(...conditions);
      const [rows, [{ count }]] = await Promise.all([
        baseQuery()
          .where(where)
          .orderBy(desc(returns.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(returns)
          .where(where),
      ]);
      return {
        items: rows.map((r) => toDto(r.ret, r.customerName, r.warehouseName, r.orderNumber)),
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
        response: { 200: z.object({ return: returnDetailDtoSchema }) },
      },
    },
    async (req) => ({ return: await loadDetail(req.user.tid, req.params.id) }),
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("orders:write"),
      schema: {
        body: returnCreateSchema,
        response: { 201: z.object({ return: returnDetailDtoSchema }) },
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
      if (!customer || !customer.types.includes("customer")) {
        throw badRequest("Cliente não encontrado");
      }
      const [wh] = await app.db
        .select()
        .from(warehouses)
        .where(
          and(
            eq(warehouses.id, body.warehouseId),
            eq(warehouses.tenantId, req.user.tid),
          ),
        );
      if (!wh) throw badRequest("Armazém não encontrado");

      let orderRow: { id: string; customerId: string } | null = null;
      if (body.orderId) {
        const [o] = await app.db
          .select({ id: orders.id, customerId: orders.customerId })
          .from(orders)
          .where(and(eq(orders.id, body.orderId), eq(orders.tenantId, req.user.tid)));
        if (!o) throw badRequest("Encomenda não encontrada");
        if (o.customerId !== body.customerId) {
          throw badRequest("A encomenda não pertence a este cliente");
        }
        orderRow = o;
      }

      const itemIds = [
        ...new Set(body.lines.map((l) => l.itemId).filter((v): v is string => !!v)),
      ];
      const itemMap = new Map<string, string>();
      if (itemIds.length > 0) {
        const found = await app.db
          .select({ id: items.id, name: items.name })
          .from(items)
          .where(and(eq(items.tenantId, req.user.tid), inArray(items.id, itemIds)));
        if (found.length !== itemIds.length) {
          throw badRequest("Um ou mais artigos não foram encontrados");
        }
        for (const i of found) itemMap.set(i.id, i.name);
      }
      for (const l of body.lines) {
        if (!l.description && !l.itemId) {
          throw badRequest("Cada linha precisa de um artigo ou descrição");
        }
      }

      const number = await nextNumber(app.db, req.user.tid, "return");
      const [ret] = await app.db
        .insert(returns)
        .values({
          tenantId: req.user.tid,
          number,
          customerId: body.customerId,
          orderId: orderRow?.id ?? null,
          warehouseId: body.warehouseId,
          reason: body.reason ?? null,
          createdBy: req.user.sub,
        })
        .returning();
      await app.db.insert(returnLines).values(
        body.lines.map((l, i) => ({
          tenantId: req.user.tid,
          returnId: ret.id,
          lineNo: i + 1,
          itemId: l.itemId ?? null,
          description: l.description || itemMap.get(l.itemId ?? "")!,
          quantity: l.quantity,
        })),
      );
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "returns.created",
        entity: "return",
        entityId: ret.id,
        metadata: { number, lines: body.lines.length },
        ip: req.ip,
      });
      return reply.code(201).send({ return: await loadDetail(req.user.tid, ret.id) });
    },
  );

  // Receção: dá entrada no armazém das quantidades pendentes (total ou parcial).
  app.post(
    "/:id/receive",
    {
      preHandler: app.requirePermission("orders:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z
          .object({
            lines: z
              .array(
                z.object({
                  lineId: z.string().uuid(),
                  qty: z.coerce.number().int().min(1),
                  /** Obrigatório para artigos serializados (= qty) */
                  serials: z.array(z.string().trim().min(1).max(80)).max(500).optional(),
                  /** Bin de putaway das unidades devolvidas */
                  locationId: z.string().uuid().optional(),
                }),
              )
              .optional(),
          })
          .default({}),
        response: { 200: z.object({ return: returnDetailDtoSchema }) },
      },
    },
    async (req) => {
      const [ret] = await app.db
        .select()
        .from(returns)
        .where(and(eq(returns.id, req.params.id), eq(returns.tenantId, req.user.tid)));
      if (!ret) throw notFound("Devolução não encontrada");
      if (ret.status === "received") throw badRequest("Devolução já recebida");
      if (ret.status === "cancelled") throw badRequest("Devolução cancelada");

      const lines = await app.db
        .select()
        .from(returnLines)
        .where(eq(returnLines.returnId, ret.id));

      const requested = req.body.lines;
      for (const line of lines) {
        const pending = line.quantity - line.receivedQty;
        if (pending <= 0) continue;
        const req_ = requested?.find((r) => r.lineId === line.id);
        const qty = requested ? (req_?.qty ?? 0) : pending;
        if (qty <= 0) continue;
        if (qty > pending) {
          throw badRequest(`Quantidade recebida excede o pendente em «${line.description}»`);
        }
        if (line.itemId) {
          const serials = req_?.serials?.map((s) => s.trim()).filter(Boolean) ?? [];
          const [it] = await app.db
            .select({ serialized: items.serialized })
            .from(items)
            .where(eq(items.id, line.itemId));
          if (it?.serialized) {
            if (new Set(serials).size !== qty || serials.length !== qty) {
              throw badRequest(
                `Artigo serializado (${line.description}): indique ${qty} número(s) de série únicos`,
              );
            }
            await returnSerials(app.db, req.user.tid, ret.warehouseId, line.itemId, serials);
          } else if (serials.length) {
            throw badRequest(`${line.description} não é gerido por número de série`);
          }
          let locCode: string | null = null;
          if (req_?.locationId) {
            const [loc] = await app.db
              .select({ code: warehouseLocations.code })
              .from(warehouseLocations)
              .where(
                and(
                  eq(warehouseLocations.id, req_.locationId),
                  eq(warehouseLocations.tenantId, req.user.tid),
                  eq(warehouseLocations.warehouseId, ret.warehouseId),
                  eq(warehouseLocations.active, true),
                ),
              );
            if (!loc) throw badRequest("Localização não encontrada neste armazém");
            locCode = loc.code;
            await applyBinDelta(
              app.db,
              req.user.tid,
              ret.warehouseId,
              req_.locationId,
              line.itemId,
              qty,
            );
          }
          await applyStockDelta(app.db, req.user.tid, ret.warehouseId, line.itemId, qty);
          await recordMovement(app.db, {
            tenantId: req.user.tid,
            type: "in",
            itemId: line.itemId,
            quantity: qty,
            warehouseId: ret.warehouseId,
            reference: ret.number,
            note: `Devolução ${ret.number}${locCode ? ` — putaway ${locCode}` : ""}${serials.length ? ` — séries: ${serials.join(", ")}` : ""}`,
            locationId: req_?.locationId ?? null,
            createdBy: req.user.sub,
          });
        }
        await app.db
          .update(returnLines)
          .set({ receivedQty: sql`${returnLines.receivedQty} + ${qty}` })
          .where(eq(returnLines.id, line.id));
      }

      // Marca como recebida quando não fica nada pendente
      const remaining = await app.db
        .select({ left: sql<number>`coalesce(sum(${returnLines.quantity} - ${returnLines.receivedQty}), 0)::int` })
        .from(returnLines)
        .where(eq(returnLines.returnId, ret.id));
      const complete = remaining[0].left === 0;
      if (complete) {
        await app.db
          .update(returns)
          .set({ status: "received", receivedAt: new Date(), updatedAt: new Date() })
          .where(eq(returns.id, ret.id));
      }
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "returns.received",
        entity: "return",
        entityId: ret.id,
        metadata: { number: ret.number, complete },
        ip: req.ip,
      });
      return { return: await loadDetail(req.user.tid, ret.id) };
    },
  );

  app.post(
    "/:id/cancel",
    {
      preHandler: app.requirePermission("orders:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ return: returnDetailDtoSchema }) },
      },
    },
    async (req) => {
      const [ret] = await app.db
        .select()
        .from(returns)
        .where(and(eq(returns.id, req.params.id), eq(returns.tenantId, req.user.tid)));
      if (!ret) throw notFound("Devolução não encontrada");
      if (ret.status === "received") throw badRequest("Não é possível cancelar uma devolução recebida");
      if (ret.status === "cancelled") throw badRequest("Devolução já cancelada");
      await app.db
        .update(returns)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(returns.id, ret.id));
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "returns.cancelled",
        entity: "return",
        entityId: ret.id,
        metadata: { number: ret.number },
        ip: req.ip,
      });
      return { return: await loadDetail(req.user.tid, ret.id) };
    },
  );
};

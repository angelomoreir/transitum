import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  countLineUpdateSchema,
  inventoryCountCreateSchema,
  inventoryCountDetailDtoSchema,
  inventoryCountDtoSchema,
  listCountsQuerySchema,
} from "@transitum/shared";
import { z } from "zod";
import {
  inventoryCountLines,
  inventoryCounts,
  itemSerials,
  items,
  stockLevels,
  warehouses,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { nextNumber } from "../lib/sequences.js";
import { applyStockDelta, recordMovement } from "../lib/stock.js";

/** Séries guardadas em `counted_serials` (JSON array de strings). */
const parseSerials = (v: string | null): string[] => {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
};

const pageResponse = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number(), page: z.number(), pageSize: z.number() });

type CountRow = typeof inventoryCounts.$inferSelect;
type LineRow = typeof inventoryCountLines.$inferSelect;
type ItemRow = typeof items.$inferSelect;

const lineDto = (l: LineRow, item: ItemRow, expectedSerials?: string[]) => ({
  itemId: l.itemId,
  sku: item.sku,
  itemName: item.name,
  unit: item.unit,
  serialized: item.serialized,
  expectedQty: l.expectedQty,
  countedQty: l.countedQty,
  variance: l.countedQty != null ? l.countedQty - l.expectedQty : null,
  ...(item.serialized
    ? { expectedSerials: expectedSerials ?? [], countedSerials: l.countedSerials ? parseSerials(l.countedSerials) : null }
    : {}),
});

const countDto = (c: CountRow, warehouseName: string, lineCount: number, countedLines: number) => ({
  id: c.id,
  number: c.number,
  status: c.status,
  warehouseId: c.warehouseId,
  warehouseName,
  lineCount,
  countedLines,
  createdAt: c.createdAt.toISOString(),
  appliedAt: c.appliedAt?.toISOString() ?? null,
});

/**
 * Contagem física de stock: snapshot do stock em mão, registo das quantidades
 * contadas e aplicação de ajustes (movimentos `adjust`) ao confirmar.
 */
export const inventoryCountRoutes: FastifyPluginAsyncZod = async (app) => {
  const loadCount = async (tid: string, id: string) => {
    const [row] = await app.db
      .select({ c: inventoryCounts, warehouseName: warehouses.name })
      .from(inventoryCounts)
      .innerJoin(warehouses, eq(inventoryCounts.warehouseId, warehouses.id))
      .where(and(eq(inventoryCounts.id, id), eq(inventoryCounts.tenantId, tid)));
    if (!row) throw notFound("Contagem não encontrada");
    return row;
  };

  const loadLines = async (tid: string, countId: string) => {
    const lines = await app.db
      .select({ l: inventoryCountLines, item: items })
      .from(inventoryCountLines)
      .innerJoin(items, eq(inventoryCountLines.itemId, items.id))
      .where(and(eq(inventoryCountLines.countId, countId), eq(inventoryCountLines.tenantId, tid)))
      .orderBy(items.sku);
    return lines;
  };

  /** Séries `in_stock` por artigo neste armazém — esperadas na contagem. */
  const expectedSerialsByItem = async (tid: string, warehouseId: string, itemIds: string[]) => {
    if (!itemIds.length) return new Map<string, string[]>();
    const rows = await app.db
      .select({ itemId: itemSerials.itemId, serial: itemSerials.serial })
      .from(itemSerials)
      .where(
        and(
          eq(itemSerials.tenantId, tid),
          eq(itemSerials.warehouseId, warehouseId),
          eq(itemSerials.status, "in_stock"),
          inArray(itemSerials.itemId, itemIds),
        ),
      );
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.itemId, [...(map.get(r.itemId) ?? []), r.serial]);
    return map;
  };

  const detail = async (tid: string, id: string) => {
    const { c, warehouseName } = await loadCount(tid, id);
    const lines = await loadLines(tid, c.id);
    const expSerials = await expectedSerialsByItem(
      tid,
      c.warehouseId,
      lines.filter((l) => l.item.serialized).map((l) => l.item.id),
    );
    return {
      count: {
        ...countDto(c, warehouseName, lines.length, lines.filter((l) => l.l.countedQty != null).length),
        lines: lines.map((l) => lineDto(l.l, l.item, expSerials.get(l.item.id))),
      },
    };
  };

  app.get(
    "/",
    {
      preHandler: app.requirePermission("inventory:read"),
      schema: {
        querystring: listCountsQuerySchema,
        response: { 200: pageResponse(inventoryCountDtoSchema) },
      },
    },
    async (req) => {
      const { page, pageSize, warehouseId, status } = req.query;
      const conditions = [eq(inventoryCounts.tenantId, req.user.tid)];
      if (warehouseId) conditions.push(eq(inventoryCounts.warehouseId, warehouseId));
      if (status) conditions.push(eq(inventoryCounts.status, status));
      const where = and(...conditions);

      const lineAgg = app.db
        .select({
          countId: inventoryCountLines.countId,
          total: sql<number>`count(*)::int`.as("total"),
          counted: sql<number>`count(${inventoryCountLines.countedQty})::int`.as("counted"),
        })
        .from(inventoryCountLines)
        .where(eq(inventoryCountLines.tenantId, req.user.tid))
        .groupBy(inventoryCountLines.countId)
        .as("lineAgg");

      const [rows, [{ count }]] = await Promise.all([
        app.db
          .select({
            c: inventoryCounts,
            warehouseName: warehouses.name,
            lineCount: sql<number>`coalesce(${lineAgg.total}, 0)`,
            countedLines: sql<number>`coalesce(${lineAgg.counted}, 0)`,
          })
          .from(inventoryCounts)
          .innerJoin(warehouses, eq(inventoryCounts.warehouseId, warehouses.id))
          .leftJoin(lineAgg, eq(lineAgg.countId, inventoryCounts.id))
          .where(where)
          .orderBy(desc(inventoryCounts.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db.select({ count: sql<number>`count(*)::int` }).from(inventoryCounts).where(where),
      ]);
      return {
        items: rows.map((r) => countDto(r.c, r.warehouseName, r.lineCount, r.countedLines)),
        total: count,
        page,
        pageSize,
      };
    },
  );

  app.get(
    "/:id",
    {
      preHandler: app.requirePermission("inventory:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ count: inventoryCountDetailDtoSchema }) },
      },
    },
    async (req) => detail(req.user.tid, req.params.id),
  );

  // Nova contagem: snapshot do stock em mão (ou dos artigos indicados)
  app.post(
    "/",
    {
      preHandler: app.requirePermission("inventory:write"),
      schema: {
        body: inventoryCountCreateSchema,
        response: { 201: z.object({ count: inventoryCountDetailDtoSchema }) },
      },
    },
    async (req, reply) => {
      const { warehouseId, itemIds } = req.body;
      const [wh] = await app.db
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, req.user.tid)));
      if (!wh) throw badRequest("Armazém não encontrado");

      // Com seleção de artigos: inclui os escolhidos mesmo sem registo de stock
      // (esperado = 0) — permite contar artigos que deveriam existir.
      let levels: { l: { itemId: string; onHand: number } | null; item: typeof items.$inferSelect }[];
      if (itemIds?.length) {
        const uniqueIds = [...new Set(itemIds)];
        const [selItems, selLevels] = await Promise.all([
          app.db
            .select()
            .from(items)
            .where(and(eq(items.tenantId, req.user.tid), inArray(items.id, uniqueIds))),
          app.db
            .select()
            .from(stockLevels)
            .where(
              and(
                eq(stockLevels.tenantId, req.user.tid),
                eq(stockLevels.warehouseId, warehouseId),
                inArray(stockLevels.itemId, uniqueIds),
              ),
            ),
        ]);
        if (selItems.length !== uniqueIds.length) {
          throw badRequest("Um ou mais artigos selecionados não foram encontrados");
        }
        const byItem = new Map(selLevels.map((l) => [l.itemId, l]));
        levels = selItems.map((item) => ({ l: byItem.get(item.id) ?? null, item }));
      } else {
        levels = await app.db
          .select({ l: stockLevels, item: items })
          .from(stockLevels)
          .innerJoin(items, eq(stockLevels.itemId, items.id))
          .where(
            and(
              eq(stockLevels.tenantId, req.user.tid),
              eq(stockLevels.warehouseId, warehouseId),
            ),
          );
        if (levels.length === 0) {
          throw badRequest("Sem artigos com registo de stock neste armazém");
        }
      }

      const number = await nextNumber(app.db, req.user.tid, "count");
      const [count] = await app.db
        .insert(inventoryCounts)
        .values({
          tenantId: req.user.tid,
          warehouseId,
          number,
          createdBy: req.user.sub,
        })
        .returning();
      const lines = await app.db
        .insert(inventoryCountLines)
        .values(
          levels.map((r) => ({
            tenantId: req.user.tid,
            countId: count.id,
            itemId: r.item.id,
            expectedQty: r.l?.onHand ?? 0,
          })),
        )
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "inventory_counts.created",
        entity: "inventory_count",
        entityId: count.id,
        metadata: { number, warehouseId, lines: lines.length },
        ip: req.ip,
      });
      return reply.code(201).send(await detail(req.user.tid, count.id));
    },
  );

  // Registo das quantidades contadas (contagem aberta)
  app.patch(
    "/:id/lines",
    {
      preHandler: app.requirePermission("inventory:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: countLineUpdateSchema,
        response: { 200: z.object({ count: inventoryCountDetailDtoSchema }) },
      },
    },
    async (req) => {
      const { c } = await loadCount(req.user.tid, req.params.id);
      if (c.status !== "open") throw badRequest("A contagem já não está aberta");

      const existing = await app.db
        .select({ l: inventoryCountLines, serialized: items.serialized, sku: items.sku })
        .from(inventoryCountLines)
        .innerJoin(items, eq(inventoryCountLines.itemId, items.id))
        .where(eq(inventoryCountLines.countId, c.id));
      const byItem = new Map(existing.map((r) => [r.l.itemId, r]));
      for (const l of req.body.lines) {
        const target = byItem.get(l.itemId);
        if (!target) throw badRequest("Artigo não pertence a esta contagem");
        // Artigos serializados contam-se por lista de séries
        if (target.serialized) {
          if (!l.serials) {
            throw badRequest(`O artigo ${target.sku} é serializado — indique as séries contadas`);
          }
          const unique = [...new Set(l.serials.map((s) => s.trim()).filter(Boolean))];
          if (l.serials.length !== unique.length) {
            throw badRequest(`Séries duplicadas na contagem de ${target.sku}`);
          }
          // Impede contaminação: séries em stock noutro armazém não podem ser
          // contadas aqui (seriam repostas neste armazém ao aplicar)
          const elsewhere = await app.db
            .select({ serial: itemSerials.serial })
            .from(itemSerials)
            .where(
              and(
                eq(itemSerials.tenantId, req.user.tid),
                eq(itemSerials.itemId, l.itemId),
                inArray(itemSerials.serial, unique),
                eq(itemSerials.status, "in_stock"),
                sql`${itemSerials.warehouseId} <> ${c.warehouseId}`,
              ),
            );
          if (elsewhere.length) {
            throw badRequest(
              `Séries em stock noutro armazém: ${elsewhere.map((r) => r.serial).join(", ")}`,
            );
          }
          await app.db
            .update(inventoryCountLines)
            .set({ countedQty: unique.length, countedSerials: JSON.stringify(unique) })
            .where(eq(inventoryCountLines.id, target.l.id));
          continue;
        }
        await app.db
          .update(inventoryCountLines)
          .set({ countedQty: l.countedQty })
          .where(eq(inventoryCountLines.id, target.l.id));
      }
      return detail(req.user.tid, c.id);
    },
  );

  // Aplica os ajustes: cada divergência vira um movimento `adjust`
  app.post(
    "/:id/apply",
    {
      preHandler: app.requirePermission("inventory:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ count: inventoryCountDetailDtoSchema }) },
      },
    },
    async (req) => {
      const { c } = await loadCount(req.user.tid, req.params.id);
      if (c.status !== "open") throw badRequest("A contagem já não está aberta");
      const lines = await loadLines(req.user.tid, c.id);
      if (lines.some((l) => l.l.countedQty == null)) {
        throw badRequest("Ainda há artigos por contar");
      }
      const expSerials = await expectedSerialsByItem(
        req.user.tid,
        c.warehouseId,
        lines.filter((l) => l.item.serialized).map((l) => l.item.id),
      );

      let adjusted = 0;
      for (const { l, item } of lines) {
        // Artigos serializados: reconcilia o conjunto de séries primeiro —
        // séries esperadas não contadas → written_off; séries contadas
        // desconhecidas → entram em stock (novas ou de volta de 'issued').
        if (item.serialized) {
          const counted = new Set(parseSerials(l.countedSerials));
          const expected = new Set(expSerials.get(l.itemId) ?? []);
          const missing = [...expected].filter((s) => !counted.has(s));
          const extra = [...counted].filter((s) => !expected.has(s));
          if (missing.length) {
            await app.db
              .update(itemSerials)
              .set({ status: "written_off", updatedAt: new Date() })
              .where(
                and(
                  eq(itemSerials.tenantId, req.user.tid),
                  eq(itemSerials.itemId, item.id),
                  eq(itemSerials.warehouseId, c.warehouseId),
                  eq(itemSerials.status, "in_stock"),
                  inArray(itemSerials.serial, missing),
                ),
              );
          }
          if (extra.length) {
            const known = await app.db
              .select({ id: itemSerials.id, serial: itemSerials.serial })
              .from(itemSerials)
              .where(
                and(
                  eq(itemSerials.tenantId, req.user.tid),
                  eq(itemSerials.itemId, item.id),
                  inArray(itemSerials.serial, extra),
                ),
              );
            const knownSet = new Set(known.map((k) => k.serial));
            if (known.length) {
              await app.db
                .update(itemSerials)
                .set({ status: "in_stock", warehouseId: c.warehouseId, updatedAt: new Date() })
                .where(inArray(itemSerials.id, known.map((k) => k.id)));
            }
            const fresh = extra.filter((s) => !knownSet.has(s));
            if (fresh.length) {
              await app.db
                .insert(itemSerials)
                .values(
                  fresh.map((serial) => ({
                    tenantId: req.user.tid,
                    itemId: item.id,
                    warehouseId: c.warehouseId,
                    serial,
                  })),
                );
            }
          }
        }

        const variance = l.countedQty! - l.expectedQty;
        if (variance === 0) continue;
        // Quebras: não pode ficar abaixo do reservado (stock já comprometido)
        await applyStockDelta(app.db, req.user.tid, c.warehouseId, l.itemId, variance, {
          respectReserved: variance < 0,
          label: item.sku,
        });
        await recordMovement(app.db, {
          tenantId: req.user.tid,
          type: "adjust",
          itemId: l.itemId,
          quantity: variance,
          warehouseId: c.warehouseId,
          reference: c.number,
          note: `Contagem física ${c.number}`,
          createdBy: req.user.sub,
        });
        adjusted++;
      }
      await app.db
        .update(inventoryCounts)
        .set({ status: "applied", appliedAt: new Date(), appliedBy: req.user.sub })
        .where(eq(inventoryCounts.id, c.id));
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "inventory_counts.applied",
        entity: "inventory_count",
        entityId: c.id,
        metadata: { number: c.number, adjusted },
        ip: req.ip,
      });
      return detail(req.user.tid, c.id);
    },
  );

  app.post(
    "/:id/cancel",
    {
      preHandler: app.requirePermission("inventory:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ count: inventoryCountDtoSchema }) },
      },
    },
    async (req) => {
      const { c, warehouseName } = await loadCount(req.user.tid, req.params.id);
      if (c.status !== "open") throw badRequest("A contagem já não está aberta");
      const [updated] = await app.db
        .update(inventoryCounts)
        .set({ status: "cancelled" })
        .where(eq(inventoryCounts.id, c.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "inventory_counts.cancelled",
        entity: "inventory_count",
        entityId: c.id,
        metadata: { number: c.number },
        ip: req.ip,
      });
      const [{ n }] = await app.db
        .select({ n: sql<number>`count(*)::int` })
        .from(inventoryCountLines)
        .where(eq(inventoryCountLines.countId, c.id));
      return { count: countDto(updated, warehouseName, n, 0) };
    },
  );
};

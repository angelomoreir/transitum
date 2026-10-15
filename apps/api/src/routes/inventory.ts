import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  itemCreateSchema,
  itemDtoSchema,
  itemUpdateSchema,
  listItemsQuerySchema,
  listMovementsQuerySchema,
  listStockQuerySchema,
  listWarehousesQuerySchema,
  movementCreateSchema,
  stockLevelDtoSchema,
  stockMovementDtoSchema,
  warehouseCreateSchema,
  warehouseDtoSchema,
  warehouseUpdateSchema,
} from "@blujay/shared";
import { z } from "zod";
import type { DB } from "../db/client.js";
import { items, stockLevels, stockMovements, users, warehouses } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { nextNumber } from "../lib/sequences.js";

const pageResponse = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number(), page: z.number(), pageSize: z.number() });

const addr = (r: {
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
}) =>
  r.addressLine1 && r.city && r.postalCode && r.country
    ? {
        line1: r.addressLine1,
        city: r.city,
        postalCode: r.postalCode,
        country: r.country,
      }
    : null;

type WarehouseRow = typeof warehouses.$inferSelect;
type ItemRow = typeof items.$inferSelect;

const warehouseDto = (r: WarehouseRow, itemCount = 0) => ({
  id: r.id,
  tenantId: r.tenantId,
  code: r.code,
  name: r.name,
  address: addr(r),
  active: r.active,
  itemCount,
  createdAt: r.createdAt.toISOString(),
});

const itemDto = (r: ItemRow, totalStock = 0) => ({
  id: r.id,
  tenantId: r.tenantId,
  sku: r.sku,
  name: r.name,
  description: r.description ?? null,
  unit: r.unit,
  weightKg: r.weightKg ?? null,
  active: r.active,
  totalStock,
  createdAt: r.createdAt.toISOString(),
});

/** Atualiza o nível de stock (cria a linha se não existir). Falha se ficar negativo. */
async function applyStockDelta(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  delta: number,
) {
  const [level] = await db
    .insert(stockLevels)
    .values({ tenantId, warehouseId, itemId, onHand: delta })
    .onConflictDoUpdate({
      target: [stockLevels.tenantId, stockLevels.warehouseId, stockLevels.itemId],
      set: { onHand: sql`${stockLevels.onHand} + ${delta}`, updatedAt: new Date() },
    })
    .returning();
  if (level.onHand < 0) {
    // Reverte antes de propagar o erro
    await db
      .update(stockLevels)
      .set({ onHand: sql`${stockLevels.onHand} - ${delta}` })
      .where(eq(stockLevels.id, level.id));
    throw badRequest("Stock insuficiente");
  }
  return level;
}

export const inventoryRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Armazéns ────────────────────────────────────────────────────────────

  app.get(
    "/warehouses",
    {
      preHandler: app.requirePermission("warehouses:read"),
      schema: {
        querystring: listWarehousesQuerySchema,
        response: { 200: pageResponse(warehouseDtoSchema) },
      },
    },
    async (req) => {
      const { page, pageSize, q, active } = req.query;
      const conditions = [eq(warehouses.tenantId, req.user.tid)];
      if (q) conditions.push(or(ilike(warehouses.name, `%${q}%`), ilike(warehouses.code, `%${q}%`))!);
      if (active !== undefined) conditions.push(eq(warehouses.active, active === "true"));
      const where = and(...conditions);

      const stockCount = app.db
        .select({
          warehouseId: stockLevels.warehouseId,
          cnt: sql<number>`count(*)::int`.as("cnt"),
        })
        .from(stockLevels)
        .where(eq(stockLevels.tenantId, req.user.tid))
        .groupBy(stockLevels.warehouseId)
        .as("stockCount");

      const [rows, [{ count }]] = await Promise.all([
        app.db
          .select({ wh: warehouses, itemCount: sql<number>`coalesce(${stockCount.cnt}, 0)` })
          .from(warehouses)
          .leftJoin(stockCount, eq(stockCount.warehouseId, warehouses.id))
          .where(where)
          .orderBy(warehouses.code)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db.select({ count: sql<number>`count(*)::int` }).from(warehouses).where(where),
      ]);
      return {
        items: rows.map((r) => warehouseDto(r.wh, r.itemCount)),
        total: count,
        page,
        pageSize,
      };
    },
  );

  app.post(
    "/warehouses",
    {
      preHandler: app.requirePermission("warehouses:write"),
      schema: {
        body: warehouseCreateSchema,
        response: { 201: z.object({ warehouse: warehouseDtoSchema }) },
      },
    },
    async (req, reply) => {
      const [wh] = await app.db
        .insert(warehouses)
        .values({
          tenantId: req.user.tid,
          code: await nextNumber(app.db, req.user.tid, "warehouse"),
          name: req.body.name,
          addressLine1: req.body.address?.line1 ?? null,
          city: req.body.address?.city ?? null,
          postalCode: req.body.address?.postalCode ?? null,
          country: req.body.address?.country ?? null,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "warehouses.created",
        entity: "warehouse",
        entityId: wh.id,
        metadata: { code: wh.code, name: wh.name },
        ip: req.ip,
      });
      return reply.code(201).send({ warehouse: warehouseDto(wh) });
    },
  );

  app.patch(
    "/warehouses/:id",
    {
      preHandler: app.requirePermission("warehouses:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: warehouseUpdateSchema,
        response: { 200: z.object({ warehouse: warehouseDtoSchema }) },
      },
    },
    async (req) => {
      const [wh] = await app.db
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, req.params.id), eq(warehouses.tenantId, req.user.tid)));
      if (!wh) throw notFound("Armazém não encontrado");
      const { address, ...rest } = req.body;
      const [updated] = await app.db
        .update(warehouses)
        .set({
          ...rest,
          ...(address !== undefined
            ? {
                addressLine1: address?.line1 ?? null,
                city: address?.city ?? null,
                postalCode: address?.postalCode ?? null,
                country: address?.country ?? null,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(warehouses.id, wh.id))
        .returning();
      return { warehouse: warehouseDto(updated) };
    },
  );

  // ── Artigos ───────────────────────────────────────────────────────────────

  app.get(
    "/items",
    {
      preHandler: app.requirePermission("inventory:read"),
      schema: {
        querystring: listItemsQuerySchema,
        response: { 200: pageResponse(itemDtoSchema) },
      },
    },
    async (req) => {
      const { page, pageSize, q, active } = req.query;
      const conditions = [eq(items.tenantId, req.user.tid)];
      if (q) conditions.push(or(ilike(items.name, `%${q}%`), ilike(items.sku, `%${q}%`))!);
      if (active !== undefined) conditions.push(eq(items.active, active === "true"));
      const where = and(...conditions);

      const stockSum = app.db
        .select({
          itemId: stockLevels.itemId,
          total: sql<number>`coalesce(sum(${stockLevels.onHand}), 0)::int`.as("total"),
        })
        .from(stockLevels)
        .where(eq(stockLevels.tenantId, req.user.tid))
        .groupBy(stockLevels.itemId)
        .as("stockSum");

      const [rows, [{ count }]] = await Promise.all([
        app.db
          .select({ item: items, totalStock: sql<number>`coalesce(${stockSum.total}, 0)` })
          .from(items)
          .leftJoin(stockSum, eq(stockSum.itemId, items.id))
          .where(where)
          .orderBy(items.sku)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db.select({ count: sql<number>`count(*)::int` }).from(items).where(where),
      ]);
      return {
        items: rows.map((r) => itemDto(r.item, r.totalStock)),
        total: count,
        page,
        pageSize,
      };
    },
  );

  app.post(
    "/items",
    {
      preHandler: app.requirePermission("inventory:write"),
      schema: { body: itemCreateSchema, response: { 201: z.object({ item: itemDtoSchema }) } },
    },
    async (req, reply) => {
      const [dup] = await app.db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.tenantId, req.user.tid), eq(items.sku, req.body.sku)));
      if (dup) throw badRequest("Já existe um artigo com esse SKU");
      const [item] = await app.db
        .insert(items)
        .values({
          tenantId: req.user.tid,
          sku: req.body.sku,
          name: req.body.name,
          description: req.body.description ?? null,
          unit: req.body.unit,
          weightKg: req.body.weightKg ?? null,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "items.created",
        entity: "item",
        entityId: item.id,
        metadata: { sku: item.sku },
        ip: req.ip,
      });
      return reply.code(201).send({ item: itemDto(item) });
    },
  );

  app.patch(
    "/items/:id",
    {
      preHandler: app.requirePermission("inventory:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: itemUpdateSchema,
        response: { 200: z.object({ item: itemDtoSchema }) },
      },
    },
    async (req) => {
      const [item] = await app.db
        .select()
        .from(items)
        .where(and(eq(items.id, req.params.id), eq(items.tenantId, req.user.tid)));
      if (!item) throw notFound("Artigo não encontrado");
      if (req.body.sku && req.body.sku !== item.sku) {
        const [dup] = await app.db
          .select({ id: items.id })
          .from(items)
          .where(and(eq(items.tenantId, req.user.tid), eq(items.sku, req.body.sku)));
        if (dup) throw badRequest("Já existe um artigo com esse SKU");
      }
      const [updated] = await app.db
        .update(items)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(items.id, item.id))
        .returning();
      return { item: itemDto(updated) };
    },
  );

  // ── Níveis de stock ─────────────────────────────────────────────────────

  app.get(
    "/stock",
    {
      preHandler: app.requirePermission("inventory:read"),
      schema: {
        querystring: listStockQuerySchema,
        response: { 200: pageResponse(stockLevelDtoSchema) },
      },
    },
    async (req) => {
      const { page, pageSize, warehouseId, itemId, q } = req.query;
      const conditions = [eq(stockLevels.tenantId, req.user.tid)];
      if (warehouseId) conditions.push(eq(stockLevels.warehouseId, warehouseId));
      if (itemId) conditions.push(eq(stockLevels.itemId, itemId));
      if (q) conditions.push(or(ilike(items.sku, `%${q}%`), ilike(items.name, `%${q}%`))!);
      const where = and(...conditions);

      const base = () =>
        app.db
          .select({
            level: stockLevels,
            wh: warehouses,
            item: items,
          })
          .from(stockLevels)
          .innerJoin(warehouses, eq(stockLevels.warehouseId, warehouses.id))
          .innerJoin(items, eq(stockLevels.itemId, items.id))
          .where(where);

      const [rows, countRows] = await Promise.all([
        base()
          .orderBy(items.sku, warehouses.code)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(stockLevels)
          .innerJoin(warehouses, eq(stockLevels.warehouseId, warehouses.id))
          .innerJoin(items, eq(stockLevels.itemId, items.id))
          .where(where),
      ]);
      return {
        items: rows.map((r) => ({
          warehouseId: r.wh.id,
          warehouseCode: r.wh.code,
          warehouseName: r.wh.name,
          itemId: r.item.id,
          sku: r.item.sku,
          itemName: r.item.name,
          unit: r.item.unit,
          onHand: r.level.onHand,
          reserved: r.level.reserved,
        })),
        total: countRows[0].count,
        page,
        pageSize,
      };
    },
  );

  // ── Movimentos de stock ─────────────────────────────────────────────────

  const toWh = alias(warehouses, "to_wh");

  app.get(
    "/movements",
    {
      preHandler: app.requirePermission("inventory:read"),
      schema: {
        querystring: listMovementsQuerySchema,
        response: { 200: pageResponse(stockMovementDtoSchema) },
      },
    },
    async (req) => {
      const { page, pageSize, warehouseId, itemId, type } = req.query;
      const conditions = [eq(stockMovements.tenantId, req.user.tid)];
      if (itemId) conditions.push(eq(stockMovements.itemId, itemId));
      if (type) conditions.push(eq(stockMovements.type, type));
      if (warehouseId) {
        conditions.push(
          or(
            eq(stockMovements.warehouseId, warehouseId),
            eq(stockMovements.toWarehouseId, warehouseId),
          )!,
        );
      }
      const where = and(...conditions);

      const base = () =>
        app.db
          .select({
            m: stockMovements,
            item: items,
            whCode: warehouses.code,
            toWhCode: toWh.code,
            userName: users.name,
          })
          .from(stockMovements)
          .innerJoin(items, eq(stockMovements.itemId, items.id))
          .leftJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
          .leftJoin(toWh, eq(stockMovements.toWarehouseId, toWh.id))
          .leftJoin(users, eq(stockMovements.createdBy, users.id))
          .where(where);

      const [rows, countRows] = await Promise.all([
        base()
          .orderBy(desc(stockMovements.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(stockMovements)
          .innerJoin(items, eq(stockMovements.itemId, items.id))
          .leftJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
          .leftJoin(toWh, eq(stockMovements.toWarehouseId, toWh.id))
          .leftJoin(users, eq(stockMovements.createdBy, users.id))
          .where(where),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.m.id,
          type: r.m.type,
          itemId: r.item.id,
          sku: r.item.sku,
          itemName: r.item.name,
          quantity: r.m.quantity,
          warehouseId: r.m.warehouseId ?? null,
          warehouseCode: r.whCode ?? null,
          toWarehouseId: r.m.toWarehouseId ?? null,
          toWarehouseCode: r.toWhCode ?? null,
          reference: r.m.reference ?? null,
          note: r.m.note ?? null,
          createdAt: r.m.createdAt.toISOString(),
          createdByName: r.userName ?? null,
        })),
        total: countRows[0].count,
        page,
        pageSize,
      };
    },
  );

  app.post(
    "/movements",
    {
      preHandler: app.requirePermission("inventory:write"),
      schema: {
        body: movementCreateSchema,
        response: { 201: z.object({ movement: stockMovementDtoSchema }) },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const [item] = await app.db
        .select()
        .from(items)
        .where(
          and(
            eq(items.id, body.itemId),
            eq(items.tenantId, req.user.tid),
            eq(items.active, true),
          ),
        );
      if (!item) throw badRequest("Artigo não encontrado ou inativo");

      const checkWarehouse = async (id: string) => {
        const [wh] = await app.db
          .select()
          .from(warehouses)
          .where(
            and(
              eq(warehouses.id, id),
              eq(warehouses.tenantId, req.user.tid),
              eq(warehouses.active, true),
            ),
          );
        if (!wh) throw badRequest("Armazém não encontrado ou inativo");
        return wh;
      };

      const from = body.warehouseId ? await checkWarehouse(body.warehouseId) : null;
      const to = body.toWarehouseId ? await checkWarehouse(body.toWarehouseId) : null;

      if (body.type === "in") {
        await applyStockDelta(app.db, req.user.tid, from!.id, item.id, body.quantity);
      } else if (body.type === "out") {
        await applyStockDelta(app.db, req.user.tid, from!.id, item.id, -body.quantity);
      } else if (body.type === "adjust") {
        await applyStockDelta(app.db, req.user.tid, from!.id, item.id, body.quantity);
      } else {
        await applyStockDelta(app.db, req.user.tid, from!.id, item.id, -body.quantity);
        await applyStockDelta(app.db, req.user.tid, to!.id, item.id, body.quantity);
      }

      const [m] = await app.db
        .insert(stockMovements)
        .values({
          tenantId: req.user.tid,
          type: body.type,
          itemId: item.id,
          quantity: body.quantity,
          warehouseId: from?.id ?? null,
          toWarehouseId: to?.id ?? null,
          reference: body.reference ?? null,
          note: body.note ?? null,
          createdBy: req.user.sub,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "stock.movement",
        entity: "stock_movement",
        entityId: m.id,
        metadata: { type: m.type, itemId: item.id, quantity: m.quantity },
        ip: req.ip,
      });
      return reply.code(201).send({
        movement: {
          id: m.id,
          type: m.type,
          itemId: item.id,
          sku: item.sku,
          itemName: item.name,
          quantity: m.quantity,
          warehouseId: m.warehouseId ?? null,
          warehouseCode: from?.code ?? null,
          toWarehouseId: m.toWarehouseId ?? null,
          toWarehouseCode: to?.code ?? null,
          reference: m.reference ?? null,
          note: m.note ?? null,
          createdAt: m.createdAt.toISOString(),
          createdByName: req.user.name,
        },
      });
    },
  );
};

import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
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
  binTransferSchema,
  itemSerialDtoSchema,
  listBinLevelsQuerySchema,
  listLotsQuerySchema,
  listSerialsQuerySchema,
  movementCreateSchema,
  pickLocationSetSchema,
  reconciliationQuerySchema,
  reorderPointUpdateSchema,
  stockAlertDtoSchema,
  stockBinLevelDtoSchema,
  stockLevelDtoSchema,
  stockLotDtoSchema,
  stockMovementDtoSchema,
  stockReconciliationDtoSchema,
  warehouseCreateSchema,
  warehouseDtoSchema,
  warehouseLocationCreateSchema,
  warehouseLocationDtoSchema,
  warehouseLocationUpdateSchema,
  warehouseUpdateSchema,
} from "@transitum/shared";
import { z } from "zod";
import {
  itemPickLocations,
  itemSerials,
  items,
  stockBinLevels,
  stockLevels,
  stockLots,
  stockMovements,
  users,
  warehouseLocations,
  warehouses,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { parseCsv } from "../lib/csv.js";
import { badRequest, notFound } from "../lib/errors.js";
import { nextNumber } from "../lib/sequences.js";
import {
  applyBinDelta,
  applyLotDelta,
  applyStockDelta,
  consumeBins,
  consumeLotsFefo,
  issueSerials,
  registerSerials,
} from "../lib/stock.js";

const MAX_IMPORT_ROWS = 500;

const ITEM_HEADERS: Record<string, string> = {
  sku: "sku", referencia: "sku", "referência": "sku", ref: "sku",
  name: "name", nome: "name", artigo: "name",
  description: "description", descricao: "description", "descrição": "description",
  unit: "unit", unidade: "unit", un: "unit",
  weightkg: "weightKg", peso: "weightKg", pesokg: "weightKg",
};

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
  serialized: r.serialized,
  active: r.active,
  totalStock,
  createdAt: r.createdAt.toISOString(),
});

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
          serialized: req.body.serialized,
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

  // Importação em massa CSV (`;` ou `,`). SKUs duplicados são saltados e
  // reportados por número de linha.
  app.post(
    "/items/import",
    {
      preHandler: app.requirePermission("inventory:write"),
      schema: {
        body: z.object({ csv: z.string().min(1).max(1_000_000) }),
        response: {
          200: z.object({
            imported: z.number(),
            errors: z.array(z.object({ row: z.number(), message: z.string() })),
          }),
        },
      },
    },
    async (req) => {
      const rows = parseCsv(req.body.csv);
      if (rows.length === 0) throw badRequest("CSV vazio ou sem cabeçalho");
      if (rows.length > MAX_IMPORT_ROWS) {
        throw badRequest(`Máximo de ${MAX_IMPORT_ROWS} linhas por importação`);
      }
      const existing = await app.db
        .select({ sku: items.sku })
        .from(items)
        .where(eq(items.tenantId, req.user.tid));
      const seen = new Set(existing.map((e) => e.sku.toUpperCase()));
      const errors: { row: number; message: string }[] = [];
      let imported = 0;
      for (let i = 0; i < rows.length; i++) {
        const raw: Record<string, string> = {};
        for (const [k, v] of Object.entries(rows[i])) {
          const key = ITEM_HEADERS[k];
          if (key) raw[key] = v;
        }
        const parsed = itemCreateSchema.safeParse({
          ...raw,
          weightKg: raw.weightKg ? Number(raw.weightKg.replace(",", ".")) : undefined,
        });
        if (!parsed.success) {
          errors.push({
            row: i + 2,
            message: parsed.error.issues.map((e) => e.message).join("; "),
          });
          continue;
        }
        if (seen.has(parsed.data.sku)) {
          errors.push({ row: i + 2, message: `SKU ${parsed.data.sku} já existe` });
          continue;
        }
        const [item] = await app.db
          .insert(items)
          .values({
            tenantId: req.user.tid,
            sku: parsed.data.sku,
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            unit: parsed.data.unit,
            weightKg: parsed.data.weightKg ?? null,
          })
          .returning();
        seen.add(item.sku);
        imported++;
      }
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "items.imported",
        entity: "item",
        entityId: req.user.tid,
        metadata: { imported, failed: errors.length },
        ip: req.ip,
      });
      return { imported, errors };
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
          reorderPoint: r.level.reorderPoint,
        })),
        total: countRows[0].count,
        page,
        pageSize,
      };
    },
  );

  // Define/limpa o ponto de reposição de um artigo num armazém (cria a linha
  // de stock se ainda não existir, com on_hand = 0)
  app.put(
    "/stock/reorder-point",
    {
      preHandler: app.requirePermission("inventory:write"),
      schema: {
        body: reorderPointUpdateSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const { itemId, warehouseId, reorderPoint } = req.body;
      const [item] = await app.db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.tenantId, req.user.tid)));
      if (!item) throw badRequest("Artigo não encontrado");
      const [wh] = await app.db
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, req.user.tid)));
      if (!wh) throw badRequest("Armazém não encontrado");

      await app.db
        .insert(stockLevels)
        .values({ tenantId: req.user.tid, warehouseId, itemId, reorderPoint })
        .onConflictDoUpdate({
          target: [
            stockLevels.tenantId,
            stockLevels.warehouseId,
            stockLevels.itemId,
          ],
          set: { reorderPoint, updatedAt: new Date() },
        });
      return { ok: true as const };
    },
  );

  // Alertas de reposição: disponível (on_hand - reserved) <= reorder_point
  app.get(
    "/stock/alerts",
    {
      preHandler: app.requirePermission("inventory:read"),
      schema: { response: { 200: z.object({ items: z.array(stockAlertDtoSchema) }) } },
    },
    async (req) => {
      const rows = await app.db
        .select({ level: stockLevels, wh: warehouses, item: items })
        .from(stockLevels)
        .innerJoin(warehouses, eq(stockLevels.warehouseId, warehouses.id))
        .innerJoin(items, eq(stockLevels.itemId, items.id))
        .where(
          and(
            eq(stockLevels.tenantId, req.user.tid),
            isNotNull(stockLevels.reorderPoint),
            sql`${stockLevels.onHand} - ${stockLevels.reserved} <= ${stockLevels.reorderPoint}`,
            eq(items.active, true),
          ),
        )
        .orderBy(items.sku, warehouses.code);
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
          reorderPoint: r.level.reorderPoint,
          available: r.level.onHand - r.level.reserved,
          deficit: r.level.reorderPoint! - (r.level.onHand - r.level.reserved),
        })),
      };
    },
  );

  /**
   * Lotes de stock com validade. `expiringDays` filtra lotes que expiram
   * dentro de N dias (inclui já expirados, daysToExpiry <= 0).
   */
  app.get(
    "/stock/lots",
    {
      preHandler: app.requirePermission("inventory:read"),
      schema: {
        querystring: listLotsQuerySchema,
        response: { 200: z.object({ items: z.array(stockLotDtoSchema) }) },
      },
    },
    async (req) => {
      const { warehouseId, itemId, expiringDays } = req.query;
      const conditions = [eq(stockLots.tenantId, req.user.tid), gt(stockLots.onHand, 0)];
      if (warehouseId) conditions.push(eq(stockLots.warehouseId, warehouseId));
      if (itemId) conditions.push(eq(stockLots.itemId, itemId));
      if (expiringDays !== undefined) {
        const limit = new Date(Date.now() + expiringDays * 86400_000).toISOString().slice(0, 10);
        conditions.push(sql`${stockLots.expiresAt} is not null and ${stockLots.expiresAt} <= ${limit}`);
      }
      const rows = await app.db
        .select({
          lot: stockLots,
          sku: items.sku,
          itemName: items.name,
          whCode: warehouses.code,
        })
        .from(stockLots)
        .innerJoin(items, eq(stockLots.itemId, items.id))
        .innerJoin(warehouses, eq(stockLots.warehouseId, warehouses.id))
        .where(and(...conditions))
        .orderBy(asc(stockLots.expiresAt), items.sku);
      const now = Date.now();
      return {
        items: rows.map((r) => ({
          id: r.lot.id,
          itemId: r.lot.itemId,
          sku: r.sku,
          itemName: r.itemName,
          warehouseId: r.lot.warehouseId,
          warehouseCode: r.whCode,
          code: r.lot.code,
          expiresAt: r.lot.expiresAt ?? null,
          onHand: r.lot.onHand,
          daysToExpiry: r.lot.expiresAt
            ? Math.floor((new Date(`${r.lot.expiresAt}T00:00:00Z`).getTime() - now) / 86400_000)
            : null,
        })),
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
            locCode: warehouseLocations.code,
            userName: users.name,
          })
          .from(stockMovements)
          .innerJoin(items, eq(stockMovements.itemId, items.id))
          .leftJoin(warehouses, eq(stockMovements.warehouseId, warehouses.id))
          .leftJoin(toWh, eq(stockMovements.toWarehouseId, toWh.id))
          .leftJoin(warehouseLocations, eq(stockMovements.locationId, warehouseLocations.id))
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
          lotCode: r.m.lotCode ?? null,
          locationCode: r.locCode ?? null,
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

      // Bin indicado (putaway / consumo dirigido) — tem de pertencer ao armazém de origem
      let location: typeof warehouseLocations.$inferSelect | null = null;
      if (body.locationId) {
        const [loc] = await app.db
          .select()
          .from(warehouseLocations)
          .where(
            and(
              eq(warehouseLocations.id, body.locationId),
              eq(warehouseLocations.tenantId, req.user.tid),
              eq(warehouseLocations.warehouseId, from!.id),
              eq(warehouseLocations.active, true),
            ),
          );
        if (!loc) throw badRequest("Localização não encontrada neste armazém");
        location = loc;
      }

      // Artigos serializados: lista de séries obrigatória e igual à quantidade
      const serials = body.serials?.map((s) => s.trim()).filter(Boolean) ?? [];
      if (item.serialized && ["in", "out", "transfer"].includes(body.type)) {
        const qty = Math.abs(body.quantity);
        if (new Set(serials).size !== qty || serials.length !== qty) {
          throw badRequest(
            `Artigo serializado: indique ${qty} número(s) de série únicos`,
          );
        }
      } else if (serials.length && !item.serialized) {
        throw badRequest("O artigo não é gerido por número de série");
      }

      // Saídas e transferências não podem consumir stock reservado para encomendas
      let fefoLots: { code: string; qty: number }[] = [];
      if (body.type === "in" || body.type === "adjust") {
        await applyStockDelta(app.db, req.user.tid, from!.id, item.id, body.quantity);
        if (body.lotCode) {
          await applyLotDelta(
            app.db,
            req.user.tid,
            from!.id,
            item.id,
            body.lotCode,
            body.quantity,
            body.lotExpiresAt ?? null,
          );
        }
        if (location && body.type === "in") {
          // Putaway: regista o bin onde a mercadoria ficou arrumada
          await applyBinDelta(app.db, req.user.tid, from!.id, location.id, item.id, body.quantity);
        }
        if (item.serialized && body.type === "in" && serials.length) {
          await registerSerials(app.db, req.user.tid, from!.id, item.id, serials);
        }
      } else if (body.type === "out") {
        await applyStockDelta(app.db, req.user.tid, from!.id, item.id, -body.quantity, {
          respectReserved: true,
        });
        // FEFO: consome primeiro os lotes com validade mais próxima
        fefoLots = await consumeLotsFefo(app.db, req.user.tid, from!.id, item.id, body.quantity);
        // Bins: do bin indicado ou da localização preferencial de picking
        if (location) {
          await applyBinDelta(app.db, req.user.tid, from!.id, location.id, item.id, -body.quantity, {
            label: item.name,
          });
        } else {
          await consumeBins(app.db, req.user.tid, from!.id, item.id, body.quantity);
        }
        if (item.serialized) {
          await issueSerials(app.db, req.user.tid, from!.id, item.id, serials);
        }
      } else {
        await applyStockDelta(app.db, req.user.tid, from!.id, item.id, -body.quantity, {
          respectReserved: true,
        });
        await applyStockDelta(app.db, req.user.tid, to!.id, item.id, body.quantity);
        if (item.serialized && serials.length) {
          // As séries mudam de armazém com a transferência
          const moved = await app.db
            .update(itemSerials)
            .set({ warehouseId: to!.id, updatedAt: new Date() })
            .where(
              and(
                eq(itemSerials.tenantId, req.user.tid),
                eq(itemSerials.itemId, item.id),
                eq(itemSerials.warehouseId, from!.id),
                eq(itemSerials.status, "in_stock"),
                inArray(itemSerials.serial, serials),
              ),
            )
            .returning({ id: itemSerials.id });
          if (moved.length !== serials.length) {
            throw badRequest("Algumas séries não estão em stock no armazém de origem");
          }
        }
      }

      const fefoNote = fefoLots.length
        ? `FEFO: ${fefoLots.map((l) => `${l.code}×${l.qty}`).join(", ")}`
        : null;
      const serialNote = serials.length ? `Séries: ${serials.join(", ")}` : null;
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
          note: [body.note, fefoNote, serialNote].filter(Boolean).join(" — ") || null,
          lotCode: body.lotCode ?? (fefoLots[0]?.code ?? null),
          locationId: location?.id ?? null,
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
          lotCode: m.lotCode ?? null,
          locationCode: location?.code ?? null,
          serials,
          createdAt: m.createdAt.toISOString(),
          createdByName: req.user.name,
        },
      });
    },
  );

  // ── Localizações (bins/zonas) ─────────────────────────────────────────────

  const assertWarehouse = async (tid: string, warehouseId: string) => {
    const [wh] = await app.db
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tid)));
    if (!wh) throw notFound("Armazém não encontrado");
    return wh;
  };

  const locationDto = (
    l: typeof warehouseLocations.$inferSelect,
    itemCount: number,
  ) => ({
    id: l.id,
    warehouseId: l.warehouseId,
    code: l.code,
    zone: l.zone ?? null,
    active: l.active,
    itemCount,
    createdAt: l.createdAt.toISOString(),
  });

  app.get(
    "/warehouses/:id/locations",
    {
      preHandler: app.requirePermission("warehouses:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ items: z.array(warehouseLocationDtoSchema) }) },
      },
    },
    async (req) => {
      await assertWarehouse(req.user.tid, req.params.id);
      const assigned = app.db
        .select({
          locationId: itemPickLocations.locationId,
          cnt: sql<number>`count(*)::int`.as("cnt"),
        })
        .from(itemPickLocations)
        .where(eq(itemPickLocations.tenantId, req.user.tid))
        .groupBy(itemPickLocations.locationId)
        .as("assigned");
      const rows = await app.db
        .select({ loc: warehouseLocations, itemCount: sql<number>`coalesce(${assigned.cnt}, 0)` })
        .from(warehouseLocations)
        .leftJoin(assigned, eq(assigned.locationId, warehouseLocations.id))
        .where(
          and(
            eq(warehouseLocations.tenantId, req.user.tid),
            eq(warehouseLocations.warehouseId, req.params.id),
          ),
        )
        .orderBy(warehouseLocations.zone, warehouseLocations.code);
      return { items: rows.map((r) => locationDto(r.loc, r.itemCount)) };
    },
  );

  app.post(
    "/warehouses/:id/locations",
    {
      preHandler: app.requirePermission("warehouses:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: warehouseLocationCreateSchema,
        response: { 201: z.object({ location: warehouseLocationDtoSchema }) },
      },
    },
    async (req, reply) => {
      await assertWarehouse(req.user.tid, req.params.id);
      const [dup] = await app.db
        .select({ id: warehouseLocations.id })
        .from(warehouseLocations)
        .where(
          and(
            eq(warehouseLocations.tenantId, req.user.tid),
            eq(warehouseLocations.warehouseId, req.params.id),
            eq(warehouseLocations.code, req.body.code),
          ),
        );
      if (dup) throw badRequest("Já existe uma localização com este código");
      const [loc] = await app.db
        .insert(warehouseLocations)
        .values({
          tenantId: req.user.tid,
          warehouseId: req.params.id,
          code: req.body.code,
          zone: req.body.zone ?? null,
        })
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "warehouse_locations.created",
        entity: "warehouse_location",
        entityId: loc.id,
        metadata: { warehouseId: req.params.id, code: loc.code },
        ip: req.ip,
      });
      return reply.code(201).send({ location: locationDto(loc, 0) });
    },
  );

  app.patch(
    "/locations/:id",
    {
      preHandler: app.requirePermission("warehouses:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: warehouseLocationUpdateSchema,
        response: { 200: z.object({ location: warehouseLocationDtoSchema }) },
      },
    },
    async (req) => {
      const [loc] = await app.db
        .select()
        .from(warehouseLocations)
        .where(
          and(
            eq(warehouseLocations.id, req.params.id),
            eq(warehouseLocations.tenantId, req.user.tid),
          ),
        );
      if (!loc) throw notFound("Localização não encontrada");
      const { zone, active } = req.body;
      const [updated] = await app.db
        .update(warehouseLocations)
        .set({
          ...(zone !== undefined ? { zone } : {}),
          ...(active !== undefined ? { active } : {}),
          updatedAt: new Date(),
        })
        .where(eq(warehouseLocations.id, loc.id))
        .returning();
      const [{ cnt }] = await app.db
        .select({ cnt: sql<number>`count(*)::int` })
        .from(itemPickLocations)
        .where(eq(itemPickLocations.locationId, loc.id));
      return { location: locationDto(updated, cnt) };
    },
  );

  /** Localizações preferenciais de picking do armazém (artigo → bin). */
  app.get(
    "/warehouses/:id/pick-locations",
    {
      preHandler: app.requirePermission("warehouses:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                itemId: z.string(),
                sku: z.string(),
                itemName: z.string(),
                locationId: z.string(),
                locationCode: z.string(),
                zone: z.string().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      await assertWarehouse(req.user.tid, req.params.id);
      const rows = await app.db
        .select({
          itemId: items.id,
          sku: items.sku,
          itemName: items.name,
          locationId: warehouseLocations.id,
          locationCode: warehouseLocations.code,
          zone: warehouseLocations.zone,
        })
        .from(itemPickLocations)
        .innerJoin(items, eq(itemPickLocations.itemId, items.id))
        .innerJoin(warehouseLocations, eq(itemPickLocations.locationId, warehouseLocations.id))
        .where(
          and(
            eq(itemPickLocations.tenantId, req.user.tid),
            eq(itemPickLocations.warehouseId, req.params.id),
          ),
        )
        .orderBy(items.sku);
      return {
        items: rows.map((r) => ({ ...r, zone: r.zone ?? null })),
      };
    },
  );

  /** Atribui/remove a localização de picking de um artigo no armazém. */
  app.put(
    "/warehouses/:id/pick-locations",
    {
      preHandler: app.requirePermission("warehouses:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: pickLocationSetSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      await assertWarehouse(req.user.tid, req.params.id);
      const { itemId, locationId } = req.body;
      const [item] = await app.db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.id, itemId), eq(items.tenantId, req.user.tid)));
      if (!item) throw badRequest("Artigo não encontrado");
      if (locationId) {
        const [loc] = await app.db
          .select({ id: warehouseLocations.id })
          .from(warehouseLocations)
          .where(
            and(
              eq(warehouseLocations.id, locationId),
              eq(warehouseLocations.tenantId, req.user.tid),
              eq(warehouseLocations.warehouseId, req.params.id),
            ),
          );
        if (!loc) throw badRequest("Localização não pertence a este armazém");
        await app.db
          .insert(itemPickLocations)
          .values({
            tenantId: req.user.tid,
            warehouseId: req.params.id,
            itemId,
            locationId,
          })
          .onConflictDoUpdate({
            target: [
              itemPickLocations.tenantId,
              itemPickLocations.warehouseId,
              itemPickLocations.itemId,
            ],
            set: { locationId },
          });
      } else {
        await app.db
          .delete(itemPickLocations)
          .where(
            and(
              eq(itemPickLocations.tenantId, req.user.tid),
              eq(itemPickLocations.warehouseId, req.params.id),
              eq(itemPickLocations.itemId, itemId),
            ),
          );
      }
      return { ok: true as const };
    },
  );

  /** Importação CSV de localizações: código;zona. */
  app.post(
    "/warehouses/:id/locations/import",
    {
      preHandler: app.requirePermission("warehouses:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ csv: z.string().min(1) }),
        response: {
          200: z.object({
            imported: z.number(),
            skipped: z.number(),
            errors: z.array(z.object({ row: z.number(), message: z.string() })),
          }),
        },
      },
    },
    async (req) => {
      await assertWarehouse(req.user.tid, req.params.id);
      const rows = parseCsv(req.body.csv).slice(0, MAX_IMPORT_ROWS);
      const outErrors: { row: number; message: string }[] = [];
      const codes = rows
        .map((r) => (r.codigo ?? r.code ?? "").trim().toUpperCase())
        .filter(Boolean);
      if (!codes.length && !outErrors.length) {
        throw badRequest("CSV sem linhas válidas (esperado: codigo;zona)");
      }
      const existing = codes.length
        ? await app.db
            .select({ code: warehouseLocations.code })
            .from(warehouseLocations)
            .where(
              and(
                eq(warehouseLocations.tenantId, req.user.tid),
                eq(warehouseLocations.warehouseId, req.params.id),
                inArray(warehouseLocations.code, codes),
              ),
            )
        : [];
      const existingCodes = new Set(existing.map((r) => r.code));
      let created = 0;
      let skipped = 0;
      for (const [i, r] of rows.entries()) {
        const code = (r.codigo ?? r.code ?? "").trim().toUpperCase();
        if (!code) {
          outErrors.push({ row: i + 2, message: "Código em falta" });
          continue;
        }
        if (existingCodes.has(code)) {
          skipped++;
          continue;
        }
        await app.db.insert(warehouseLocations).values({
          tenantId: req.user.tid,
          warehouseId: req.params.id,
          code,
          zone: (r.zona ?? r.zone ?? "").trim() || null,
        });
        existingCodes.add(code);
        created++;
      }
      return { imported: created, skipped, errors: outErrors };
    },
  );

  // ── Stock por bin ───────────────────────────────────────────────────────

  // Quantidades físicas por localização (só aparecem bins com unidades arrumadas).
  app.get(
    "/stock/bin-levels",
    {
      preHandler: app.requirePermission("inventory:read"),
      schema: {
        querystring: listBinLevelsQuerySchema,
        response: { 200: z.object({ items: z.array(stockBinLevelDtoSchema) }) },
      },
    },
    async (req) => {
      const { warehouseId, itemId } = req.query;
      const rows = await app.db
        .select({ level: stockBinLevels, loc: warehouseLocations, it: items, wh: warehouses })
        .from(stockBinLevels)
        .innerJoin(warehouseLocations, eq(warehouseLocations.id, stockBinLevels.locationId))
        .innerJoin(items, eq(items.id, stockBinLevels.itemId))
        .innerJoin(warehouses, eq(warehouses.id, stockBinLevels.warehouseId))
        .where(
          and(
            eq(stockBinLevels.tenantId, req.user.tid),
            warehouseId ? eq(stockBinLevels.warehouseId, warehouseId) : undefined,
            itemId ? eq(stockBinLevels.itemId, itemId) : undefined,
          ),
        )
        .orderBy(warehouseLocations.code);
      return {
        items: rows.map((r) => ({
          locationId: r.loc.id,
          locationCode: r.loc.code,
          zone: r.loc.zone ?? null,
          warehouseId: r.wh.id,
          warehouseCode: r.wh.code,
          itemId: r.it.id,
          sku: r.it.sku,
          itemName: r.it.name,
          onHand: r.level.onHand,
        })),
      };
    },
  );

  // Transferência bin → bin dentro do mesmo armazém (não altera o total).
  app.post(
    "/stock/bin-transfer",
    {
      preHandler: app.requirePermission("inventory:write"),
      schema: {
        body: binTransferSchema,
        response: { 201: z.object({ ok: z.boolean() }) },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const serials = body.serials?.map((s) => s.trim()).filter(Boolean) ?? [];

      const [item] = await app.db
        .select()
        .from(items)
        .where(and(eq(items.id, body.itemId), eq(items.tenantId, req.user.tid)));
      if (!item) throw badRequest("Artigo não encontrado");

      const loadLoc = async (id: string) => {
        const [loc] = await app.db
          .select()
          .from(warehouseLocations)
          .where(
            and(
              eq(warehouseLocations.id, id),
              eq(warehouseLocations.tenantId, req.user.tid),
              eq(warehouseLocations.warehouseId, body.warehouseId),
              eq(warehouseLocations.active, true),
            ),
          );
        if (!loc) throw badRequest("Localização não encontrada neste armazém");
        return loc;
      };
      const [fromLoc, toLoc] = await Promise.all([
        loadLoc(body.fromLocationId),
        loadLoc(body.toLocationId),
      ]);

      if (item.serialized) {
        if (new Set(serials).size !== body.quantity || serials.length !== body.quantity) {
          throw badRequest(
            `Artigo serializado: indique ${body.quantity} número(s) de série únicos`,
          );
        }
      } else if (serials.length) {
        throw badRequest("O artigo não é gerido por número de série");
      }

      await app.db.transaction(async (tx) => {
        await applyBinDelta(
          tx,
          req.user.tid,
          body.warehouseId,
          fromLoc.id,
          item.id,
          -body.quantity,
          { label: item.name },
        );
        await applyBinDelta(tx, req.user.tid, body.warehouseId, toLoc.id, item.id, body.quantity);
        await tx.insert(stockMovements).values({
          tenantId: req.user.tid,
          type: "transfer",
          itemId: item.id,
          quantity: body.quantity,
          warehouseId: body.warehouseId,
          locationId: fromLoc.id,
          note: `Bin ${fromLoc.code} → ${toLoc.code}${serials.length ? ` — Séries: ${serials.join(", ")}` : ""}`,
          createdBy: req.user.sub,
        });
      });

      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "stock.bin_transfer",
        entity: "item",
        entityId: item.id,
        metadata: {
          warehouseId: body.warehouseId,
          from: fromLoc.code,
          to: toLoc.code,
          quantity: body.quantity,
        },
        ip: req.ip,
      });
      return reply.code(201).send({ ok: true });
    },
  );

  // Números de série com estado e posição atual.
  app.get(
    "/stock/serials",
    {
      preHandler: app.requirePermission("inventory:read"),
      schema: {
        querystring: listSerialsQuerySchema,
        response: { 200: z.object({ items: z.array(itemSerialDtoSchema) }) },
      },
    },
    async (req) => {
      const { itemId, warehouseId, status, q } = req.query;
      const rows = await app.db
        .select({ s: itemSerials, it: items, wh: warehouses })
        .from(itemSerials)
        .innerJoin(items, eq(items.id, itemSerials.itemId))
        .innerJoin(warehouses, eq(warehouses.id, itemSerials.warehouseId))
        .where(
          and(
            eq(itemSerials.tenantId, req.user.tid),
            itemId ? eq(itemSerials.itemId, itemId) : undefined,
            warehouseId ? eq(itemSerials.warehouseId, warehouseId) : undefined,
            status ? eq(itemSerials.status, status) : undefined,
            q ? ilike(itemSerials.serial, `%${q}%`) : undefined,
          ),
        )
        .orderBy(itemSerials.createdAt)
        .limit(500);
      return {
        items: rows.map((r) => ({
          id: r.s.id,
          serial: r.s.serial,
          status: r.s.status,
          itemId: r.it.id,
          sku: r.it.sku,
          itemName: r.it.name,
          warehouseId: r.wh.id,
          warehouseCode: r.wh.code,
          createdAt: r.s.createdAt.toISOString(),
        })),
      };
    },
  );

  /**
   * Reconciliação: compara o `on_hand` do armazém com a soma dos bins, lotes
   * e séries em stock — deteta divergências criadas por movimentos sem
   * localização/lote ou dados históricos.
   */
  app.get(
    "/stock/reconciliation",
    {
      preHandler: app.requirePermission("inventory:read"),
      schema: {
        querystring: reconciliationQuerySchema,
        response: { 200: z.object({ items: z.array(stockReconciliationDtoSchema) }) },
      },
    },
    async (req) => {
      const { warehouseId, discrepantOnly } = req.query;
      const [wh] = await app.db
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, req.user.tid)));
      if (!wh) throw badRequest("Armazém não encontrado");

      const tid = req.user.tid;
      const [levels, binSums, lotSums, serialCounts] = await Promise.all([
        app.db
          .select({ l: stockLevels, it: items })
          .from(stockLevels)
          .innerJoin(items, eq(stockLevels.itemId, items.id))
          .where(and(eq(stockLevels.tenantId, tid), eq(stockLevels.warehouseId, warehouseId))),
        app.db
          .select({
            itemId: stockBinLevels.itemId,
            sum: sql<number>`coalesce(sum(${stockBinLevels.onHand}),0)::int`,
          })
          .from(stockBinLevels)
          .where(and(eq(stockBinLevels.tenantId, tid), eq(stockBinLevels.warehouseId, warehouseId)))
          .groupBy(stockBinLevels.itemId),
        app.db
          .select({
            itemId: stockLots.itemId,
            sum: sql<number>`coalesce(sum(${stockLots.onHand}),0)::int`,
          })
          .from(stockLots)
          .where(and(eq(stockLots.tenantId, tid), eq(stockLots.warehouseId, warehouseId)))
          .groupBy(stockLots.itemId),
        app.db
          .select({
            itemId: itemSerials.itemId,
            n: sql<number>`count(*)::int`,
          })
          .from(itemSerials)
          .where(
            and(
              eq(itemSerials.tenantId, tid),
              eq(itemSerials.warehouseId, warehouseId),
              eq(itemSerials.status, "in_stock"),
            ),
          )
          .groupBy(itemSerials.itemId),
      ]);
      const binByItem = new Map(binSums.map((r) => [r.itemId, r.sum]));
      const lotByItem = new Map(lotSums.map((r) => [r.itemId, r.sum]));
      const serialByItem = new Map(serialCounts.map((r) => [r.itemId, r.n]));

      const rows = levels.map(({ l, it }) => {
        const binsOnHand = binByItem.has(it.id) ? binByItem.get(it.id)! : null;
        const lotsOnHand = lotByItem.has(it.id) ? lotByItem.get(it.id)! : null;
        const serialsInStock = it.serialized ? (serialByItem.get(it.id) ?? 0) : null;
        const binDiff = binsOnHand != null ? binsOnHand - l.onHand : null;
        const lotDiff = lotsOnHand != null ? lotsOnHand - l.onHand : null;
        const serialDiff = serialsInStock != null ? serialsInStock - l.onHand : null;
        const discrepant = !!(binDiff || lotDiff || serialDiff);
        return {
          warehouseId: wh.id,
          warehouseCode: wh.code,
          itemId: it.id,
          sku: it.sku,
          itemName: it.name,
          serialized: it.serialized,
          onHand: l.onHand,
          binsOnHand,
          lotsOnHand,
          serialsInStock,
          binDiff,
          lotDiff,
          serialDiff,
          discrepant,
        };
      });
      return { items: discrepantOnly ? rows.filter((r) => r.discrepant) : rows };
    },
  );
};

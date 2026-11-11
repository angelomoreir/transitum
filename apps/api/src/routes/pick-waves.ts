import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  listPickWavesQuerySchema,
  PICK_WAVE_TRANSITIONS,
  pickWaveLinesUpdateSchema,
  pickWaveRecordCreateSchema,
  pickWaveRecordDetailDtoSchema,
  pickWaveRecordDtoSchema,
  pickWaveRecordUpdateSchema,
  type PickWaveStatus,
} from "@transitum/shared";
import { z } from "zod";
import {
  itemPickLocations,
  items,
  orderLines,
  orders,
  pickWaveLines,
  pickWaves,
  users,
  warehouseLocations,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { nextNumber } from "../lib/sequences.js";

const pageResponse = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number(), page: z.number(), pageSize: z.number() });

const STATUS_LABELS: Record<PickWaveStatus, string> = {
  open: "Aberta",
  in_progress: "Em separação",
  done: "Concluída",
  cancelled: "Cancelada",
};

type WaveRow = typeof pickWaves.$inferSelect;
type LineRow = typeof pickWaveLines.$inferSelect;

const lineDto = (l: LineRow, orderNumber: string) => ({
  id: l.id,
  orderId: l.orderId,
  orderNumber,
  orderLineId: l.orderLineId,
  itemId: l.itemId ?? null,
  sku: l.sku ?? null,
  itemName: l.itemName,
  location: l.location ?? null,
  quantity: l.quantity,
  pickedQty: l.pickedQty,
  pickedAt: l.pickedAt?.toISOString() ?? null,
});

const waveDto = (
  w: WaveRow,
  assignedToName: string | null,
  createdByName: string | null,
  warehouseName: string | null,
  lineCount: number,
  pickedCount: number,
) => ({
  id: w.id,
  number: w.number,
  status: w.status,
  assignedTo: w.assignedTo ?? null,
  assignedToName,
  warehouseName,
  lineCount,
  pickedCount,
  createdByName,
  createdAt: w.createdAt.toISOString(),
  completedAt: w.completedAt?.toISOString() ?? null,
});

/**
 * Waves de picking persistidas — criadas a partir das linhas por expedir de
 * um conjunto de encomendas, atribuídas a um operador e com progresso por
 * linha (pickedQty). Concluem-se automaticamente quando tudo está separado.
 */
export const pickWaveRoutes: FastifyPluginAsyncZod = async (app) => {
  const loadWave = async (tid: string, id: string) => {
    const [row] = await app.db
      .select({
        w: pickWaves,
        assignedToName: users.name,
        warehouseName: sql<string | null>`(
          select w2.name from orders o
          left join warehouses w2 on w2.id = o.warehouse_id
          where o.id = (
            select order_id from pick_wave_lines where wave_id = ${pickWaves.id} limit 1
          )
        )`,
      })
      .from(pickWaves)
      .leftJoin(users, eq(pickWaves.assignedTo, users.id))
      .where(and(eq(pickWaves.id, id), eq(pickWaves.tenantId, tid)));
    if (!row) throw notFound("Wave não encontrada");
    const [creator] = row.w.createdBy
      ? await app.db.select({ name: users.name }).from(users).where(eq(users.id, row.w.createdBy))
      : [null];
    return { w: row.w, assignedToName: row.assignedToName, createdByName: creator?.name ?? null, warehouseName: row.warehouseName };
  };

  const loadLines = async (tid: string, waveId: string) => {
    const rows = await app.db
      .select({ l: pickWaveLines, orderNumber: orders.number })
      .from(pickWaveLines)
      .innerJoin(orders, eq(pickWaveLines.orderId, orders.id))
      .where(and(eq(pickWaveLines.waveId, waveId), eq(pickWaveLines.tenantId, tid)))
      .orderBy(pickWaveLines.location, orders.number);
    return rows;
  };

  const progress = (rows: { l: LineRow }[]) => ({
    lineCount: rows.length,
    pickedCount: rows.filter((r) => r.l.pickedQty >= r.l.quantity).length,
  });

  app.get(
    "/",
    {
      preHandler: app.requirePermission("orders:read"),
      schema: {
        querystring: listPickWavesQuerySchema,
        response: { 200: pageResponse(pickWaveRecordDtoSchema) },
      },
    },
    async (req) => {
      const { page, pageSize, status, assignedTo } = req.query;
      const conditions = [eq(pickWaves.tenantId, req.user.tid)];
      if (status) conditions.push(eq(pickWaves.status, status));
      if (assignedTo) conditions.push(eq(pickWaves.assignedTo, assignedTo));
      const where = and(...conditions);

      const lineAgg = app.db
        .select({
          waveId: pickWaveLines.waveId,
          total: sql<number>`count(*)::int`.as("total"),
          picked: sql<number>`count(*) filter (where ${pickWaveLines.pickedQty} >= ${pickWaveLines.quantity})::int`.as("picked"),
        })
        .from(pickWaveLines)
        .where(eq(pickWaveLines.tenantId, req.user.tid))
        .groupBy(pickWaveLines.waveId)
        .as("lineAgg");
      const assignee = alias(users, "assignee");

      const [rows, [{ count }]] = await Promise.all([
        app.db
          .select({
            w: pickWaves,
            assignedToName: assignee.name,
            createdByName: users.name,
            lineCount: sql<number>`coalesce(${lineAgg.total}, 0)`,
            pickedCount: sql<number>`coalesce(${lineAgg.picked}, 0)`,
          })
          .from(pickWaves)
          .leftJoin(assignee, eq(pickWaves.assignedTo, assignee.id))
          .leftJoin(users, eq(pickWaves.createdBy, users.id))
          .leftJoin(lineAgg, eq(lineAgg.waveId, pickWaves.id))
          .where(where)
          .orderBy(desc(pickWaves.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db.select({ count: sql<number>`count(*)::int` }).from(pickWaves).where(where),
      ]);
      return {
        items: rows.map((r) =>
          waveDto(r.w, r.assignedToName, r.createdByName, null, r.lineCount, r.pickedCount),
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
      preHandler: app.requirePermission("orders:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ wave: pickWaveRecordDetailDtoSchema }) },
      },
    },
    async (req) => {
      const { w, assignedToName, createdByName, warehouseName } = await loadWave(req.user.tid, req.params.id);
      const rows = await loadLines(req.user.tid, w.id);
      const { lineCount, pickedCount } = progress(rows);
      return {
        wave: {
          ...waveDto(w, assignedToName, createdByName, warehouseName, lineCount, pickedCount),
          lines: rows.map((r) => lineDto(r.l, r.orderNumber)),
        },
      };
    },
  );

  // Cria a wave a partir das linhas por expedir das encomendas indicadas
  app.post(
    "/",
    {
      preHandler: app.requirePermission("orders:write"),
      schema: {
        body: pickWaveRecordCreateSchema,
        response: { 201: z.object({ wave: pickWaveRecordDetailDtoSchema }) },
      },
    },
    async (req, reply) => {
      const tid = req.user.tid;
      const { orderIds, assignedTo } = req.body;
      if (assignedTo) {
        const [u] = await app.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, assignedTo), eq(users.tenantId, tid), eq(users.status, "active")));
        if (!u) throw badRequest("Operador não encontrado");
      }

      const orderRows = await app.db
        .select({ o: orders })
        .from(orders)
        .where(and(eq(orders.tenantId, tid), inArray(orders.id, orderIds), eq(orders.status, "confirmed")));
      if (!orderRows.length) {
        throw badRequest("Nenhuma encomenda confirmada nas seleccionadas");
      }
      const ids = orderRows.map((r) => r.o.id);
      const whIds = [...new Set(orderRows.map((r) => r.o.warehouseId).filter((v): v is string => !!v))];

      const lines = await app.db
        .select({ l: orderLines, sku: items.sku, itemName: items.name })
        .from(orderLines)
        .leftJoin(items, eq(orderLines.itemId, items.id))
        .where(and(eq(orderLines.tenantId, tid), inArray(orderLines.orderId, ids)));
      const remaining = lines.filter((l) => l.l.quantity - l.l.shippedQty > 0);
      if (!remaining.length) {
        throw badRequest("As encomendas seleccionadas não têm linhas por expedir");
      }

      // Localizações preferenciais (para a etiqueta de percurso)
      const itemIds = [...new Set(remaining.map((l) => l.l.itemId).filter((v): v is string => !!v))];
      const orderWh = new Map(orderRows.map((r) => [r.o.id, r.o.warehouseId]));
      const pickLocs =
        itemIds.length && whIds.length
          ? await app.db
              .select({
                warehouseId: itemPickLocations.warehouseId,
                itemId: itemPickLocations.itemId,
                code: warehouseLocations.code,
                zone: warehouseLocations.zone,
              })
              .from(itemPickLocations)
              .innerJoin(warehouseLocations, eq(itemPickLocations.locationId, warehouseLocations.id))
              .where(
                and(
                  eq(itemPickLocations.tenantId, tid),
                  inArray(itemPickLocations.warehouseId, whIds),
                  inArray(itemPickLocations.itemId, itemIds),
                  eq(warehouseLocations.active, true),
                ),
              )
          : [];
      const locByKey = new Map(
        pickLocs.map((l) => [`${l.warehouseId}:${l.itemId}`, l.zone ? `${l.zone}-${l.code}` : l.code]),
      );

      const number = await nextNumber(app.db, tid, "pick_wave");
      const [wave] = await app.db
        .insert(pickWaves)
        .values({ tenantId: tid, number, assignedTo: assignedTo ?? null, createdBy: req.user.sub })
        .returning();
      await app.db.insert(pickWaveLines).values(
        remaining.map((l) => ({
          tenantId: tid,
          waveId: wave.id,
          orderId: l.l.orderId,
          orderLineId: l.l.id,
          itemId: l.l.itemId ?? null,
          sku: l.sku ?? null,
          itemName: l.itemName ?? l.l.description,
          location: l.l.itemId ? (locByKey.get(`${orderWh.get(l.l.orderId)}:${l.l.itemId}`) ?? null) : null,
          quantity: l.l.quantity - l.l.shippedQty,
        })),
      );
      await audit(app.db, {
        tenantId: tid,
        actorId: req.user.sub,
        action: "pick_waves.created",
        entity: "pick_wave",
        entityId: wave.id,
        metadata: { number, orders: ids.length, lines: remaining.length },
        ip: req.ip,
      });
      const rows = await loadLines(tid, wave.id);
      return reply.code(201).send({
        wave: {
          ...waveDto(wave, null, req.user.name ?? null, null, rows.length, 0),
          lines: rows.map((r) => lineDto(r.l, r.orderNumber)),
        },
      });
    },
  );

  // Atribuição de operador e transições de estado da wave
  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("orders:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: pickWaveRecordUpdateSchema,
        response: { 200: z.object({ wave: pickWaveRecordDetailDtoSchema }) },
      },
    },
    async (req) => {
      const tid = req.user.tid;
      const { w } = await loadWave(tid, req.params.id);
      const next = req.body.status;
      if (next) {
        const allowed = PICK_WAVE_TRANSITIONS[w.status as PickWaveStatus] ?? [];
        if (!allowed.includes(next)) {
          throw badRequest(`Transição inválida: ${STATUS_LABELS[w.status as PickWaveStatus]} → ${STATUS_LABELS[next]}`);
        }
      }
      if (req.body.assignedTo) {
        const [u] = await app.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, req.body.assignedTo), eq(users.tenantId, tid), eq(users.status, "active")));
        if (!u) throw badRequest("Operador não encontrado");
      }
      const [updated] = await app.db
        .update(pickWaves)
        .set({
          ...(next ? { status: next } : {}),
          ...(req.body.assignedTo !== undefined ? { assignedTo: req.body.assignedTo } : {}),
          completedAt: next === "done" ? new Date() : next === "cancelled" ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(pickWaves.id, w.id))
        .returning();
      await audit(app.db, {
        tenantId: tid,
        actorId: req.user.sub,
        action: "pick_waves.updated",
        entity: "pick_wave",
        entityId: w.id,
        metadata: { number: w.number, status: next ?? w.status, assignedTo: req.body.assignedTo },
        ip: req.ip,
      });
      const { assignedToName, createdByName, warehouseName } = await loadWave(tid, w.id);
      const rows = await loadLines(tid, w.id);
      const { lineCount, pickedCount } = progress(rows);
      return {
        wave: {
          ...waveDto(updated, assignedToName, createdByName, warehouseName, lineCount, pickedCount),
          lines: rows.map((r) => lineDto(r.l, r.orderNumber)),
        },
      };
    },
  );

  // Registo de picking por linha — a wave conclui-se quando tudo está separado
  app.patch(
    "/:id/lines",
    {
      preHandler: app.requirePermission("orders:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: pickWaveLinesUpdateSchema,
        response: { 200: z.object({ wave: pickWaveRecordDetailDtoSchema }) },
      },
    },
    async (req) => {
      const tid = req.user.tid;
      const { w } = await loadWave(tid, req.params.id);
      if (w.status !== "open" && w.status !== "in_progress") {
        throw badRequest("A wave já não está em separação");
      }
      const rows = await loadLines(tid, w.id);
      const byId = new Map(rows.map((r) => [r.l.id, r.l]));
      for (const l of req.body.lines) {
        const target = byId.get(l.id);
        if (!target) throw badRequest("Linha não pertence a esta wave");
        if (l.pickedQty > target.quantity) {
          throw badRequest(`Quantidade separada excede o previsto (${target.quantity})`);
        }
        await app.db
          .update(pickWaveLines)
          .set({
            pickedQty: l.pickedQty,
            pickedAt: l.pickedQty >= target.quantity ? new Date() : null,
            pickedBy: l.pickedQty >= target.quantity ? req.user.sub : null,
          })
          .where(eq(pickWaveLines.id, target.id));
      }
      // Auto-conclusão: todas as linhas separadas → done
      const after = await loadLines(tid, w.id);
      const allPicked = after.every((r) => r.l.pickedQty >= r.l.quantity);
      const finalStatus = allPicked ? "done" : w.status === "open" ? "in_progress" : w.status;
      const [updated] = await app.db
        .update(pickWaves)
        .set({
          status: finalStatus,
          completedAt: allPicked ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(pickWaves.id, w.id))
        .returning();
      await audit(app.db, {
        tenantId: tid,
        actorId: req.user.sub,
        action: "pick_waves.picked",
        entity: "pick_wave",
        entityId: w.id,
        metadata: { number: w.number, lines: req.body.lines.length, allPicked },
        ip: req.ip,
      });
      const { assignedToName, createdByName, warehouseName } = await loadWave(tid, w.id);
      const { lineCount, pickedCount } = progress(after);
      return {
        wave: {
          ...waveDto(updated, assignedToName, createdByName, warehouseName, lineCount, pickedCount),
          lines: after.map((r) => lineDto(r.l, r.orderNumber)),
        },
      };
    },
  );
};

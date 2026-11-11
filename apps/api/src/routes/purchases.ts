import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  listPoQuerySchema,
  PO_TRANSITIONS,
  poCreateSchema,
  poReceiveSchema,
  poStatusUpdateSchema,
  purchaseOrderDetailDtoSchema,
  purchaseOrderDtoSchema,
  type PoStatus,
} from "@transitum/shared";
import { z } from "zod";
import {
  items,
  partners,
  purchaseOrderLines,
  purchaseOrders,
  warehouseLocations,
  warehouses,
} from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { notifyTenant } from "../lib/notify.js";
import { nextNumber } from "../lib/sequences.js";
import {
  applyBinDelta,
  applyLotDelta,
  applyStockDelta,
  recordMovement,
  registerSerials,
} from "../lib/stock.js";

type PoRow = typeof purchaseOrders.$inferSelect;
type LineRow = typeof purchaseOrderLines.$inferSelect;

const poDto = (
  r: PoRow,
  supplierName: string,
  warehouseName: string,
  lineCount: number,
  totalQty: number,
  receivedQty: number,
) => ({
  id: r.id,
  tenantId: r.tenantId,
  number: r.number,
  status: r.status,
  supplierId: r.supplierId,
  supplierName,
  warehouseId: r.warehouseId,
  warehouseName,
  expectedDate: r.expectedDate ?? null,
  notes: r.notes ?? null,
  lineCount,
  totalQty,
  receivedQty,
  createdAt: r.createdAt.toISOString(),
});

const lineDto = (l: LineRow, item: { sku: string; name: string; unit: string }) => ({
  id: l.id,
  lineNo: l.lineNo,
  itemId: l.itemId,
  sku: item.sku,
  itemName: item.name,
  description: l.description ?? null,
  quantity: l.quantity,
  receivedQty: l.receivedQty,
  unit: item.unit,
  unitPrice: l.unitPrice ?? null,
});

export const purchaseRoutes: FastifyPluginAsyncZod = async (app) => {
  const poBase = () =>
    app.db
      .select({
        po: purchaseOrders,
        supplierName: partners.name,
        warehouseName: warehouses.name,
      })
      .from(purchaseOrders)
      .innerJoin(partners, eq(purchaseOrders.supplierId, partners.id))
      .innerJoin(warehouses, eq(purchaseOrders.warehouseId, warehouses.id));

  app.get(
    "/",
    {
      preHandler: app.requirePermission("purchases:read"),
      schema: {
        querystring: listPoQuerySchema,
        response: {
          200: z.object({
            items: z.array(purchaseOrderDtoSchema),
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
          }),
        },
      },
    },
    async (req) => {
      const { page, pageSize, q, status, supplierId } = req.query;
      const conditions = [eq(purchaseOrders.tenantId, req.user.tid)];
      if (status) conditions.push(eq(purchaseOrders.status, status));
      if (supplierId) conditions.push(eq(purchaseOrders.supplierId, supplierId));
      if (q) {
        conditions.push(
          or(
            ilike(purchaseOrders.number, `%${q}%`),
            ilike(partners.name, `%${q}%`),
          )!,
        );
      }
      const where = and(...conditions);

      const lineAgg = app.db
        .select({
          poId: purchaseOrderLines.poId,
          cnt: sql<number>`count(*)::int`.as("cnt"),
          qty: sql<number>`coalesce(sum(${purchaseOrderLines.quantity}), 0)::int`.as("qty"),
          rcv: sql<number>`coalesce(sum(${purchaseOrderLines.receivedQty}), 0)::int`.as("rcv"),
        })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.tenantId, req.user.tid))
        .groupBy(purchaseOrderLines.poId)
        .as("lineAgg");

      const [rows, countRows] = await Promise.all([
        app.db
          .select({
            po: purchaseOrders,
            supplierName: partners.name,
            warehouseName: warehouses.name,
            lineCount: sql<number>`coalesce(${lineAgg.cnt}, 0)`,
            totalQty: sql<number>`coalesce(${lineAgg.qty}, 0)`,
            receivedQty: sql<number>`coalesce(${lineAgg.rcv}, 0)`,
          })
          .from(purchaseOrders)
          .innerJoin(partners, eq(purchaseOrders.supplierId, partners.id))
          .innerJoin(warehouses, eq(purchaseOrders.warehouseId, warehouses.id))
          .leftJoin(lineAgg, eq(lineAgg.poId, purchaseOrders.id))
          .where(where)
          .orderBy(desc(purchaseOrders.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        app.db
          .select({ count: sql<number>`count(*)::int` })
          .from(purchaseOrders)
          .innerJoin(partners, eq(purchaseOrders.supplierId, partners.id))
          .where(where),
      ]);
      return {
        items: rows.map((r) =>
          poDto(r.po, r.supplierName, r.warehouseName, r.lineCount, r.totalQty, r.receivedQty),
        ),
        total: countRows[0].count,
        page,
        pageSize,
      };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("purchases:write"),
      schema: {
        body: poCreateSchema,
        response: { 201: z.object({ purchaseOrder: purchaseOrderDetailDtoSchema }) },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const [supplier] = await app.db
        .select()
        .from(partners)
        .where(
          and(
            eq(partners.id, body.supplierId),
            eq(partners.tenantId, req.user.tid),
            eq(partners.active, true),
          ),
        );
      if (!supplier || !supplier.types.includes("supplier")) {
        throw badRequest("O parceiro selecionado não é um fornecedor ativo");
      }
      const [wh] = await app.db
        .select()
        .from(warehouses)
        .where(
          and(
            eq(warehouses.id, body.warehouseId),
            eq(warehouses.tenantId, req.user.tid),
            eq(warehouses.active, true),
          ),
        );
      if (!wh) throw badRequest("Armazém de destino não encontrado ou inativo");

      const itemIds = [...new Set(body.lines.map((l) => l.itemId))];
      const dbItems = await app.db
        .select()
        .from(items)
        .where(and(eq(items.tenantId, req.user.tid), eq(items.active, true)));
      const itemMap = new Map(dbItems.map((i) => [i.id, i]));
      for (const id of itemIds) {
        if (!itemMap.has(id)) throw badRequest("Linha com artigo inexistente ou inativo");
      }

      const number = await nextNumber(app.db, req.user.tid, "purchase_order");
      const [po] = await app.db
        .insert(purchaseOrders)
        .values({
          tenantId: req.user.tid,
          number,
          supplierId: body.supplierId,
          warehouseId: body.warehouseId,
          expectedDate: body.expectedDate ?? null,
          notes: body.notes ?? null,
          createdBy: req.user.sub,
        })
        .returning();
      const lineRows = await app.db
        .insert(purchaseOrderLines)
        .values(
          body.lines.map((l, i) => ({
            tenantId: req.user.tid,
            poId: po.id,
            itemId: l.itemId,
            lineNo: i + 1,
            description: l.description ?? null,
            quantity: l.quantity,
            unitPrice: l.unitPrice ?? null,
          })),
        )
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "purchases.created",
        entity: "purchase_order",
        entityId: po.id,
        metadata: { number: po.number, supplierId: body.supplierId },
        ip: req.ip,
      });
      return reply.code(201).send({
        purchaseOrder: {
          ...poDto(po, supplier.name, wh.name, lineRows.length, 0, 0),
          totalQty: lineRows.reduce((s, l) => s + l.quantity, 0),
          lines: lineRows.map((l) => lineDto(l, itemMap.get(l.itemId)!)),
        },
      });
    },
  );

  app.get(
    "/:id",
    {
      preHandler: app.requirePermission("purchases:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ purchaseOrder: purchaseOrderDetailDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await poBase().where(
        and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.tenantId, req.user.tid)),
      );
      if (!row) throw notFound("Compra não encontrada");
      const lines = await app.db
        .select({ line: purchaseOrderLines, item: items })
        .from(purchaseOrderLines)
        .innerJoin(items, eq(purchaseOrderLines.itemId, items.id))
        .where(eq(purchaseOrderLines.poId, row.po.id))
        .orderBy(purchaseOrderLines.lineNo);
      return {
        purchaseOrder: {
          ...poDto(
            row.po,
            row.supplierName,
            row.warehouseName,
            lines.length,
            lines.reduce((s, l) => s + l.line.quantity, 0),
            lines.reduce((s, l) => s + l.line.receivedQty, 0),
          ),
          lines: lines.map((l) => lineDto(l.line, l.item)),
        },
      };
    },
  );

  app.post(
    "/:id/status",
    {
      preHandler: app.requirePermission("purchases:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: poStatusUpdateSchema,
        response: { 200: z.object({ purchaseOrder: purchaseOrderDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await poBase().where(
        and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.tenantId, req.user.tid)),
      );
      if (!row) throw notFound("Compra não encontrada");
      const next = req.body.status;
      const allowed = PO_TRANSITIONS[row.po.status as PoStatus] ?? [];
      if (!allowed.includes(next)) {
        throw badRequest(`Transição inválida: ${row.po.status} → ${next}`);
      }
      const [updated] = await app.db
        .update(purchaseOrders)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(purchaseOrders.id, row.po.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "purchases.status_changed",
        entity: "purchase_order",
        entityId: row.po.id,
        metadata: { from: row.po.status, to: next },
        ip: req.ip,
      });
      const [agg] = await app.db
        .select({
          cnt: sql<number>`count(*)::int`,
          qty: sql<number>`coalesce(sum(${purchaseOrderLines.quantity}), 0)::int`,
          rcv: sql<number>`coalesce(sum(${purchaseOrderLines.receivedQty}), 0)::int`,
        })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.poId, row.po.id));
      return {
        purchaseOrder: poDto(
          updated,
          row.supplierName,
          row.warehouseName,
          agg.cnt,
          agg.qty,
          agg.rcv,
        ),
      };
    },
  );

  // Receção: atualiza quantidades recebidas, cria movimentos de entrada e stock
  app.post(
    "/:id/receive",
    {
      preHandler: app.requirePermission("purchases:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: poReceiveSchema,
        response: { 200: z.object({ purchaseOrder: purchaseOrderDetailDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await poBase().where(
        and(eq(purchaseOrders.id, req.params.id), eq(purchaseOrders.tenantId, req.user.tid)),
      );
      if (!row) throw notFound("Compra não encontrada");
      if (!["sent", "partially_received"].includes(row.po.status)) {
        throw badRequest("Só é possível receber compras enviadas ao fornecedor");
      }

      const lines = await app.db
        .select({ line: purchaseOrderLines, item: items })
        .from(purchaseOrderLines)
        .innerJoin(items, eq(purchaseOrderLines.itemId, items.id))
        .where(eq(purchaseOrderLines.poId, row.po.id));
      const lineMap = new Map(lines.map((l) => [l.line.id, l]));

      for (const r of req.body.lines) {
        const l = lineMap.get(r.lineId);
        if (!l) throw badRequest("Linha não pertence a esta compra");
        const remaining = l.line.quantity - l.line.receivedQty;
        if (r.quantity > remaining) {
          throw badRequest(
            `Quantidade excede o pendente na linha ${l.line.lineNo} (${remaining} restantes)`,
          );
        }
      }

      // Aplicar receção
      for (const r of req.body.lines) {
        const l = lineMap.get(r.lineId)!;
        const serials = r.serials?.map((s) => s.trim()).filter(Boolean) ?? [];
        if (l.item.serialized) {
          if (new Set(serials).size !== r.quantity || serials.length !== r.quantity) {
            throw badRequest(
              `Artigo serializado (${l.item.sku}): indique ${r.quantity} número(s) de série únicos`,
            );
          }
        } else if (serials.length) {
          throw badRequest(`${l.item.sku} não é gerido por número de série`);
        }
        // Bin de putaway — tem de pertencer ao armazém da compra
        let locCode: string | null = null;
        if (r.locationId) {
          const [loc] = await app.db
            .select({ id: warehouseLocations.id, code: warehouseLocations.code })
            .from(warehouseLocations)
            .where(
              and(
                eq(warehouseLocations.id, r.locationId),
                eq(warehouseLocations.tenantId, req.user.tid),
                eq(warehouseLocations.warehouseId, row.po.warehouseId),
                eq(warehouseLocations.active, true),
              ),
            );
          if (!loc) throw badRequest("Localização não encontrada neste armazém");
          locCode = loc.code;
        }
        await app.db
          .update(purchaseOrderLines)
          .set({ receivedQty: sql`${purchaseOrderLines.receivedQty} + ${r.quantity}` })
          .where(eq(purchaseOrderLines.id, l.line.id));
        await applyStockDelta(app.db, req.user.tid, row.po.warehouseId, l.line.itemId, r.quantity);
        if (r.lotCode) {
          await applyLotDelta(
            app.db,
            req.user.tid,
            row.po.warehouseId,
            l.line.itemId,
            r.lotCode,
            r.quantity,
            r.lotExpiresAt ?? null,
          );
        }
        if (r.locationId) {
          await applyBinDelta(
            app.db,
            req.user.tid,
            row.po.warehouseId,
            r.locationId,
            l.line.itemId,
            r.quantity,
          );
        }
        if (l.item.serialized) {
          await registerSerials(app.db, req.user.tid, row.po.warehouseId, l.line.itemId, serials);
        }
        await recordMovement(app.db, {
          tenantId: req.user.tid,
          type: "in",
          itemId: l.line.itemId,
          quantity: r.quantity,
          warehouseId: row.po.warehouseId,
          reference: row.po.number,
          note: `Receção ${row.po.number} — linha ${l.line.lineNo}${locCode ? ` — putaway ${locCode}` : ""}${serials.length ? ` — séries: ${serials.join(", ")}` : ""}`,
          lotCode: r.lotCode ?? null,
          locationId: r.locationId ?? null,
          createdBy: req.user.sub,
        });
      }

      // Recalcular estado
      const [agg] = await app.db
        .select({
          qty: sql<number>`coalesce(sum(${purchaseOrderLines.quantity}), 0)::int`,
          rcv: sql<number>`coalesce(sum(${purchaseOrderLines.receivedQty}), 0)::int`,
          cnt: sql<number>`count(*)::int`,
        })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.poId, row.po.id));
      const nextStatus: PoStatus = agg.rcv >= agg.qty ? "received" : "partially_received";
      const [updated] = await app.db
        .update(purchaseOrders)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(purchaseOrders.id, row.po.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "purchases.received",
        entity: "purchase_order",
        entityId: row.po.id,
        metadata: { number: row.po.number, status: nextStatus },
        ip: req.ip,
      });
      if (nextStatus === "received") {
        await notifyTenant(app.db, {
          tenantId: req.user.tid,
          trigger: "purchase_order.received",
          title: `Receção concluída: ${row.po.number}`,
          link: `/purchases/${row.po.id}`,
        });
      }

      const freshLines = await app.db
        .select({ line: purchaseOrderLines, item: items })
        .from(purchaseOrderLines)
        .innerJoin(items, eq(purchaseOrderLines.itemId, items.id))
        .where(eq(purchaseOrderLines.poId, row.po.id))
        .orderBy(purchaseOrderLines.lineNo);
      return {
        purchaseOrder: {
          ...poDto(updated, row.supplierName, row.warehouseName, agg.cnt, agg.qty, agg.rcv),
          lines: freshLines.map((l) => lineDto(l.line, l.item)),
        },
      };
    },
  );
};

import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  listOrdersQuerySchema,
  orderCreateSchema,
  orderDetailDtoSchema,
  orderDtoSchema,
  orderUpdateSchema,
  pickListDtoSchema,
  pickWaveCreateSchema,
  pickWaveDtoSchema,
} from "@transitum/shared";
import { z } from "zod";
import { itemPickLocations, items, orderLines, orders, partners, shipments, stockLevels, tenants, warehouseLocations, warehouses } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { parseCsv } from "../lib/csv.js";
import { badRequest, notFound } from "../lib/errors.js";
import { notifyTenant } from "../lib/notify.js";
import { nextNumber } from "../lib/sequences.js";
import { orderLineToDto, orderToDto, orderTotal } from "../lib/dto.js";
import { releaseReservation, reserveStock } from "../lib/stock.js";
import { pickListPdf } from "../lib/pdf.js";
import type { DB } from "../db/client.js";

const listResponse = z.object({
  items: z.array(orderDtoSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const ORDER_TRANSITIONS: Record<string, string[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["cancelled"],
  cancelled: [],
};

type LineInsert = typeof orderLines.$inferInsert;

const MAX_IMPORT_ROWS = 500;

/** Cabeçalhos CSV (pt/en) → campos de encomenda/linha. */
const ORDER_HEADERS: Record<string, string> = {
  encomenda: "ref",
  ref: "ref",
  order: "ref",
  referencia: "ref",
  referência: "ref",
  cliente: "customer",
  customer: "customer",
  nif: "taxId",
  taxid: "taxId",
  armazem: "warehouse",
  armazém: "warehouse",
  warehouse: "warehouse",
  data: "requestedDate",
  date: "requestedDate",
  requesteddate: "requestedDate",
  notas: "notes",
  notes: "notes",
  morada: "deliveryLine1",
  address: "deliveryLine1",
  cidade: "deliveryCity",
  city: "deliveryCity",
  codpostal: "deliveryPostalCode",
  postalcode: "deliveryPostalCode",
  cp: "deliveryPostalCode",
  pais: "deliveryCountry",
  país: "deliveryCountry",
  country: "deliveryCountry",
  sku: "sku",
  descricao: "description",
  descrição: "description",
  description: "description",
  quantidade: "quantity",
  qty: "quantity",
  quantity: "quantity",
  preco: "unitPrice",
  preço: "unitPrice",
  price: "unitPrice",
  unitprice: "unitPrice",
};

/** Carrega os artigos referenciados nas linhas e valida que pertencem ao tenant. */
async function loadLineItems(db: DB, tenantId: string, itemIds: string[]) {
  if (itemIds.length === 0) return new Map<string, typeof items.$inferSelect>();
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.tenantId, tenantId), inArray(items.id, [...new Set(itemIds)])));
  const map = new Map(rows.map((i) => [i.id, i]));
  for (const id of itemIds) {
    if (!map.has(id)) throw badRequest("Artigo não encontrado no catálogo");
  }
  return map;
}

/** Reserva stock das linhas com artigo ao confirmar a encomenda. */
async function reserveOrderStock(
  db: DB,
  tenantId: string,
  warehouseId: string,
  lines: (typeof orderLines.$inferSelect)[],
) {
  const done: { lineId: string; itemId: string; qty: number }[] = [];
  try {
    for (const l of lines) {
      if (!l.itemId) continue;
      const qty = l.quantity - l.reservedQty;
      if (qty <= 0) continue;
      await reserveStock(db, tenantId, warehouseId, l.itemId, qty, l.description);
      await db
        .update(orderLines)
        .set({ reservedQty: sql`${orderLines.reservedQty} + ${qty}` })
        .where(eq(orderLines.id, l.id));
      done.push({ lineId: l.id, itemId: l.itemId, qty });
    }
  } catch (err) {
    for (const d of done) {
      await releaseReservation(db, tenantId, warehouseId, d.itemId, d.qty);
      await db
        .update(orderLines)
        .set({ reservedQty: sql`greatest(${orderLines.reservedQty} - ${d.qty}, 0)` })
        .where(eq(orderLines.id, d.lineId));
    }
    throw err;
  }
}

/** Ao cancelar: devolve ao disponível o que ainda está reservado. */
async function releaseOrderStock(
  db: DB,
  tenantId: string,
  warehouseId: string,
  lines: (typeof orderLines.$inferSelect)[],
) {
  for (const l of lines) {
    if (!l.itemId || l.reservedQty <= 0) continue;
    await releaseReservation(db, tenantId, warehouseId, l.itemId, l.reservedQty);
    await db.update(orderLines).set({ reservedQty: 0 }).where(eq(orderLines.id, l.id));
  }
}

export const orderRoutes: FastifyPluginAsyncZod = async (app) => {
  const warehouseName = async (warehouseId: string | null) => {
    if (!warehouseId) return null;
    const [w] = await app.db
      .select({ name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.id, warehouseId));
    return w?.name ?? null;
  };

  const linesWithItems = async (orderId: string) => {
    const lines = await app.db
      .select()
      .from(orderLines)
      .where(eq(orderLines.orderId, orderId))
      .orderBy(orderLines.lineNo);
    const itemMap = await loadLineItems(
      app.db,
      lines[0]?.tenantId ?? "",
      lines.map((l) => l.itemId).filter((v): v is string => !!v),
    );
    return lines.map((l) => orderLineToDto(l, itemMap.get(l.itemId ?? "") ?? null));
  };

  app.get(
    "/",
    {
      preHandler: app.requirePermission("orders:read"),
      schema: { querystring: listOrdersQuerySchema, response: { 200: listResponse } },
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

      const [rows, [{ count }]] = await Promise.all([
        app.db
          .select({ order: orders, customerName: partners.name, warehouseName: warehouses.name })
          .from(orders)
          .innerJoin(partners, eq(orders.customerId, partners.id))
          .leftJoin(warehouses, eq(orders.warehouseId, warehouses.id))
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
        items: rows.map((r) => orderToDto(r.order, r.customerName, r.warehouseName ?? null)),
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

      const [lines, linkedShipments] = await Promise.all([
        linesWithItems(row.order.id),
        app.db
          .select({ id: shipments.id, number: shipments.number, status: shipments.status })
          .from(shipments)
          .where(eq(shipments.orderId, row.order.id)),
      ]);
      return {
        order: {
          ...orderToDto(row.order, row.customerName, await warehouseName(row.order.warehouseId)),
          lines,
          totalValue: orderTotal(lines),
          shipments: linkedShipments,
        },
      };
    },
  );

  /** Carrega a guia de picking da encomenda (linhas por expedir + stock disponível). */
  const loadPickList = async (tid: string, orderId: string) => {
    const [row] = await app.db
      .select({ order: orders, customerName: partners.name, warehouseName: warehouses.name })
      .from(orders)
      .innerJoin(partners, eq(orders.customerId, partners.id))
      .leftJoin(warehouses, eq(orders.warehouseId, warehouses.id))
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, tid)));
    if (!row) throw notFound("Encomenda não encontrada");

    const lines = await app.db
      .select({
        line: orderLines,
        sku: items.sku,
        itemName: items.name,
        unit: items.unit,
      })
      .from(orderLines)
      .leftJoin(items, eq(orderLines.itemId, items.id))
      .where(eq(orderLines.orderId, row.order.id))
      .orderBy(orderLines.lineNo);

    const itemIds = [...new Set(lines.map((l) => l.line.itemId).filter((v): v is string => !!v))];
    const levels =
      row.order.warehouseId && itemIds.length > 0
        ? await app.db
            .select()
            .from(stockLevels)
            .where(
              and(
                eq(stockLevels.tenantId, tid),
                eq(stockLevels.warehouseId, row.order.warehouseId),
                inArray(stockLevels.itemId, itemIds),
              ),
            )
        : [];
    const byItem = new Map(levels.map((l) => [l.itemId, l]));

    // Localizações preferenciais de picking dos artigos neste armazém
    const pickLocs =
      row.order.warehouseId && itemIds.length > 0
        ? await app.db
            .select({
              itemId: itemPickLocations.itemId,
              code: warehouseLocations.code,
              zone: warehouseLocations.zone,
            })
            .from(itemPickLocations)
            .innerJoin(
              warehouseLocations,
              eq(itemPickLocations.locationId, warehouseLocations.id),
            )
            .where(
              and(
                eq(itemPickLocations.tenantId, tid),
                eq(itemPickLocations.warehouseId, row.order.warehouseId),
                inArray(itemPickLocations.itemId, itemIds),
                eq(warehouseLocations.active, true),
              ),
            )
        : [];
    const locByItem = new Map(
      pickLocs.map((l) => [l.itemId, l.zone ? `${l.zone}-${l.code}` : l.code]),
    );

    const locSort = (l: { location: string | null }) =>
      l.location ?? "￿";

    return {
      order: row.order,
      pickList: {
        orderId: row.order.id,
        number: row.order.number,
        customerName: row.customerName,
        warehouseName: row.warehouseName ?? null,
        requestedDate: row.order.requestedDate ?? null,
        lines: lines
          .map(({ line, sku, itemName, unit }) => {
            const toPick = line.quantity - line.shippedQty;
            const lvl = line.itemId ? byItem.get(line.itemId) : null;
            return {
              sku: sku ?? null,
              itemName: itemName ?? line.description,
              itemId: line.itemId ?? null,
              unit: unit ?? null,
              ordered: line.quantity,
              reserved: line.reservedQty,
              shipped: line.shippedQty,
              toPick,
              // Sem armazém/artigo → null; com artigo sem registo de stock → 0
              available:
                !row.order.warehouseId || !line.itemId
                  ? null
                  : (lvl?.onHand ?? 0) - (lvl?.reserved ?? 0),
              location: line.itemId ? (locByItem.get(line.itemId) ?? null) : null,
            };
          })
          .filter((l) => l.toPick > 0)
          // Percurso de picking ordenado por localização (sem localização no fim)
          .sort((a, b) => locSort(a).localeCompare(locSort(b))),
      },
    };
  };

  app.get(
    "/:id/picklist",
    {
      preHandler: app.requirePermission("orders:read"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ pickList: pickListDtoSchema }) },
      },
    },
    async (req) => ({ pickList: (await loadPickList(req.user.tid, req.params.id)).pickList }),
  );

  app.get(
    "/:id/picklist.pdf",
    {
      preHandler: app.requirePermission("orders:read"),
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const { order, pickList } = await loadPickList(req.user.tid, req.params.id);
      const [tenant] = await app.db
        .select()
        .from(tenants)
        .where(eq(tenants.id, req.user.tid));
      const pdf = await pickListPdf({
        issuer: {
          name: tenant?.name ?? "",
          taxId: tenant?.taxId ?? null,
          line1: tenant?.addressLine1 ?? null,
          city: tenant?.city ?? null,
          postalCode: tenant?.postalCode ?? null,
          country: tenant?.country ?? null,
        },
        orderNumber: order.number,
        customerName: pickList.customerName,
        warehouseName: pickList.warehouseName,
        requestedDate: order.requestedDate ?? null,
        delivery: order.deliveryLine1
          ? {
              name: pickList.customerName,
              taxId: null,
              line1: order.deliveryLine1,
              city: order.deliveryCity,
              postalCode: order.deliveryPostalCode,
              country: order.deliveryCountry,
            }
          : null,
        lines: pickList.lines.map((l) => ({
          sku: l.sku,
          itemName: l.itemName,
          toPick: l.toPick,
          available: l.available,
          unit: l.unit,
          location: l.location,
        })),
      });
      return reply
        .header("Content-Type", "application/pdf")
        .header(
          "Content-Disposition",
          `inline; filename="picking-${order.number}.pdf"`,
        )
        .send(pdf);
    },
  );

  /**
   * Wave picking — guia agregada que junta as linhas por expedir de várias
   * encomendas, ordenada pelo percurso zona→localização para uma só passagem
   * pelo armazém. Linhas agrupadas por artigo + armazém.
   */
  app.post(
    "/pick-wave",
    {
      preHandler: app.requirePermission("orders:read"),
      schema: {
        body: pickWaveCreateSchema,
        response: { 200: z.object({ wave: pickWaveDtoSchema }) },
      },
    },
    async (req) => {
      const tid = req.user.tid;
      const orderRows = await app.db
        .select({
          order: orders,
          customerName: partners.name,
          warehouseName: warehouses.name,
        })
        .from(orders)
        .innerJoin(partners, eq(orders.customerId, partners.id))
        .leftJoin(warehouses, eq(orders.warehouseId, warehouses.id))
        .where(and(eq(orders.tenantId, tid), inArray(orders.id, req.body.orderIds)));
      if (orderRows.length === 0) throw notFound("Nenhuma encomenda encontrada");

      const byOrderId = new Map(orderRows.map((r) => [r.order.id, r]));
      const lines = await app.db
        .select({ line: orderLines, sku: items.sku, itemName: items.name, unit: items.unit })
        .from(orderLines)
        .leftJoin(items, eq(orderLines.itemId, items.id))
        .where(and(eq(orderLines.tenantId, tid), inArray(orderLines.orderId, req.body.orderIds)));

      const itemIds = [...new Set(lines.map((l) => l.line.itemId).filter((v): v is string => !!v))];
      const whIds = [...new Set(orderRows.map((r) => r.order.warehouseId).filter((v): v is string => !!v))];
      const levels =
        itemIds.length && whIds.length
          ? await app.db
              .select()
              .from(stockLevels)
              .where(
                and(
                  eq(stockLevels.tenantId, tid),
                  inArray(stockLevels.warehouseId, whIds),
                  inArray(stockLevels.itemId, itemIds),
                ),
              )
          : [];
      const byLevel = new Map(levels.map((l) => [`${l.warehouseId}:${l.itemId}`, l]));
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

      // Agrega por (artigo ou descrição) × armazém
      const groups = new Map<
        string,
        {
          sku: string | null;
          itemName: string;
          itemId: string | null;
          unit: string | null;
          location: string | null;
          available: number | null;
          toPick: number;
          orders: { orderNumber: string; qty: number }[];
        }
      >();
      for (const { line, sku, itemName, unit } of lines) {
        const toPick = line.quantity - line.shippedQty;
        if (toPick <= 0) continue;
        const o = byOrderId.get(line.orderId)!;
        const whId = o.order.warehouseId;
        const key = `${whId ?? "none"}:${line.itemId ?? `text:${line.description}`}`;
        let g = groups.get(key);
        if (!g) {
          const lvl = whId && line.itemId ? byLevel.get(`${whId}:${line.itemId}`) : undefined;
          g = {
            sku: sku ?? null,
            itemName: itemName ?? line.description,
            itemId: line.itemId ?? null,
            unit: unit ?? null,
            location: whId && line.itemId ? (locByKey.get(`${whId}:${line.itemId}`) ?? null) : null,
            available: !whId || !line.itemId ? null : (lvl?.onHand ?? 0) - (lvl?.reserved ?? 0),
            toPick: 0,
            orders: [],
          };
          groups.set(key, g);
        }
        g.toPick += toPick;
        g.orders.push({ orderNumber: o.order.number, qty: toPick });
      }

      const whNames = [...new Set(orderRows.map((r) => r.warehouseName).filter(Boolean))];
      return {
        wave: {
          orders: orderRows.map((r) => ({
            id: r.order.id,
            number: r.order.number,
            customerName: r.customerName,
          })),
          warehouseName: whNames.length === 1 ? whNames[0]! : whNames.length ? whNames.join(" + ") : null,
          lines: [...groups.values()].sort((a, b) =>
            (a.location ?? "￿").localeCompare(b.location ?? "￿") ||
            (a.sku ?? a.itemName).localeCompare(b.sku ?? b.itemName),
          ),
        },
      };
    },
  );

  app.post(
    "/",
    {
      preHandler: app.requirePermission("orders:write"),
      schema: {
        body: orderCreateSchema,
        response: { 201: z.object({ order: orderDetailDtoSchema }) },
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
      if (body.warehouseId) {
        const [w] = await app.db
          .select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(warehouses.id, body.warehouseId), eq(warehouses.tenantId, req.user.tid)));
        if (!w) throw badRequest("Armazém não encontrado");
      }
      const itemMap = await loadLineItems(
        app.db,
        req.user.tid,
        body.lines.map((l) => l.itemId).filter((v): v is string => !!v),
      );

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
          createdBy: req.user.sub,
        })
        .returning();
      const values: LineInsert[] = body.lines.map((l, i) => ({
        tenantId: req.user.tid,
        orderId: order.id,
        lineNo: i + 1,
        itemId: l.itemId ?? null,
        description: l.description || itemMap.get(l.itemId ?? "")!.name,
        quantity: l.quantity,
        weightKg: l.weightKg ?? (itemMap.get(l.itemId ?? "")?.weightKg != null ? itemMap.get(l.itemId ?? "")!.weightKg! * l.quantity : null),
        unitPrice: l.unitPrice ?? null,
      }));
      const lines = await app.db.insert(orderLines).values(values).returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: "orders.created",
        entity: "order",
        entityId: order.id,
        metadata: { number, customerId: body.customerId },
        ip: req.ip,
      });
      const dtos = lines.map((l) => orderLineToDto(l, itemMap.get(l.itemId ?? "") ?? null));
      return reply.code(201).send({
        order: {
          ...orderToDto(order, customer.name, await warehouseName(order.warehouseId)),
          lines: dtos,
          totalValue: orderTotal(dtos),
          shipments: [],
        },
      });
    },
  );

  /**
   * Importação CSV de encomendas. Linhas com a mesma `ref`/`encomenda` são
   * agrupadas na mesma encomenda (várias linhas). Cliente é resolvido por
   * `cliente` (nome exato, case-insensitive) ou `nif`; artigos por `sku`.
   * Encomendas são criadas em rascunho — a reserva de stock acontece ao confirmar.
   */
  app.post(
    "/import",
    {
      preHandler: app.requirePermission("orders:write"),
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
      const tid = req.user.tid;
      const rows = parseCsv(req.body.csv);
      if (rows.length === 0) throw badRequest("CSV vazio ou sem cabeçalho");
      if (rows.length > MAX_IMPORT_ROWS) {
        throw badRequest(`Máximo de ${MAX_IMPORT_ROWS} linhas por importação`);
      }

      // Normaliza cabeçalhos e agrupa linhas por referência de encomenda
      const norm = rows.map((r, i) => {
        const raw: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) {
          const key = ORDER_HEADERS[k];
          if (key) raw[key] = v;
        }
        return { row: i + 2, raw };
      });
      const groups = new Map<string, { row: number; raw: Record<string, string> }[]>();
      for (const n of norm) {
        const key = n.raw.ref || `__row${n.row}`;
        const g = groups.get(key) ?? [];
        g.push(n);
        groups.set(key, g);
      }

      // Pré-carrega clientes, artigos e armazéns do tenant para resolução por nome/sku/nif
      const [allCustomers, allItems, allWarehouses] = await Promise.all([
        app.db
          .select()
          .from(partners)
          .where(and(eq(partners.tenantId, tid), eq(partners.active, true))),
        app.db.select().from(items).where(and(eq(items.tenantId, tid), eq(items.active, true))),
        app.db.select().from(warehouses).where(and(eq(warehouses.tenantId, tid), eq(warehouses.active, true))),
      ]);
      const byName = new Map(allCustomers.map((p) => [p.name.toLowerCase(), p]));
      const byTaxId = new Map(allCustomers.filter((p) => p.taxId).map((p) => [p.taxId!, p]));
      const bySku = new Map(allItems.map((i) => [i.sku.toLowerCase(), i]));
      const whByName = new Map(allWarehouses.map((w) => [w.name.toLowerCase(), w]));

      const errors: { row: number; message: string }[] = [];
      let imported = 0;
      for (const groupRows of groups.values()) {
        const first = groupRows[0];
        try {
          const customer = first.raw.taxId
            ? byTaxId.get(first.raw.taxId)
            : byName.get((first.raw.customer ?? "").toLowerCase());
          if (!customer || !customer.types.includes("customer")) {
            throw badRequest("Cliente não encontrado (use o nome exato ou o NIF)");
          }
          let warehouseId: string | undefined;
          if (first.raw.warehouse) {
            warehouseId = whByName.get(first.raw.warehouse.toLowerCase())?.id;
            if (!warehouseId) throw badRequest(`Armazém "${first.raw.warehouse}" não encontrado`);
          }
          const lines = groupRows.map(({ raw }) => ({
            itemId: raw.sku ? bySku.get(raw.sku.toLowerCase())?.id : undefined,
            description: raw.description || undefined,
            quantity: raw.quantity || undefined,
            unitPrice: raw.unitPrice || undefined,
          }));
          for (let i = 0; i < groupRows.length; i++) {
            if (groupRows[i].raw.sku && !lines[i].itemId) {
              throw badRequest(`SKU "${groupRows[i].raw.sku}" não encontrado no catálogo`);
            }
          }
          const parsed = orderCreateSchema.safeParse({
            customerId: customer.id,
            warehouseId,
            requestedDate: first.raw.requestedDate || undefined,
            notes: first.raw.notes || undefined,
            deliveryLine1: first.raw.deliveryLine1 || undefined,
            deliveryCity: first.raw.deliveryCity || undefined,
            deliveryPostalCode: first.raw.deliveryPostalCode || undefined,
            deliveryCountry: first.raw.deliveryCountry || undefined,
            lines: lines.map((l) => ({
              ...l,
              quantity: l.quantity ? Number(l.quantity) : undefined,
              unitPrice: l.unitPrice ? Number(l.unitPrice) : undefined,
            })),
          });
          if (!parsed.success) {
            throw badRequest(parsed.error.issues.map((e) => e.message).join("; "));
          }

          const itemMap = await loadLineItems(
            app.db,
            tid,
            parsed.data.lines.map((l) => l.itemId).filter((v): v is string => !!v),
          );
          const number = await nextNumber(app.db, tid, "order");
          const [order] = await app.db
            .insert(orders)
            .values({
              tenantId: tid,
              number,
              customerId: parsed.data.customerId,
              warehouseId: parsed.data.warehouseId ?? null,
              requestedDate: parsed.data.requestedDate || null,
              notes: parsed.data.notes ?? null,
              deliveryLine1: parsed.data.deliveryLine1 ?? null,
              deliveryCity: parsed.data.deliveryCity ?? null,
              deliveryPostalCode: parsed.data.deliveryPostalCode ?? null,
              deliveryCountry: parsed.data.deliveryCountry ?? null,
              createdBy: req.user.sub,
            })
            .returning();
          const values: LineInsert[] = parsed.data.lines.map((l, i) => ({
            tenantId: tid,
            orderId: order.id,
            lineNo: i + 1,
            itemId: l.itemId ?? null,
            description: l.description || itemMap.get(l.itemId ?? "")!.name,
            quantity: l.quantity,
            weightKg:
              l.weightKg ??
              (itemMap.get(l.itemId ?? "")?.weightKg != null
                ? itemMap.get(l.itemId ?? "")!.weightKg! * l.quantity
                : null),
            unitPrice: l.unitPrice ?? null,
          }));
          await app.db.insert(orderLines).values(values);
          await audit(app.db, {
            tenantId: tid,
            actorId: req.user.sub,
            action: "orders.created",
            entity: "order",
            entityId: order.id,
            metadata: { number, customerId: customer.id, import: true },
            ip: req.ip,
          });
          imported++;
        } catch (err) {
          errors.push({
            row: first.row,
            message: err instanceof Error ? err.message : "Linha inválida",
          });
        }
      }
      await audit(app.db, {
        tenantId: tid,
        actorId: req.user.sub,
        action: "orders.imported",
        entity: "order",
        entityId: tid,
        metadata: { imported, failed: errors.length },
        ip: req.ip,
      });
      return { imported, errors };
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: app.requirePermission("orders:write"),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: orderUpdateSchema,
        response: { 200: z.object({ order: orderDtoSchema }) },
      },
    },
    async (req) => {
      const [row] = await app.db
        .select({ order: orders, customerName: partners.name })
        .from(orders)
        .innerJoin(partners, eq(orders.customerId, partners.id))
        .where(and(eq(orders.id, req.params.id), eq(orders.tenantId, req.user.tid)));
      if (!row) throw notFound("Encomenda não encontrada");

      if (req.body.status) {
        const allowed = ORDER_TRANSITIONS[row.order.status] ?? [];
        if (!allowed.includes(req.body.status)) {
          throw badRequest(`Transição inválida: ${row.order.status} → ${req.body.status}`);
        }
      }
      const warehouseId =
        req.body.warehouseId === null ? null : (req.body.warehouseId ?? row.order.warehouseId);
      if (req.body.warehouseId !== undefined && row.order.status !== "draft") {
        throw badRequest("O armazém só pode ser alterado em rascunho");
      }
      if (warehouseId) {
        const [w] = await app.db
          .select({ id: warehouses.id })
          .from(warehouses)
          .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, req.user.tid)));
        if (!w) throw badRequest("Armazém não encontrado");
      }

      const lines = await app.db.select().from(orderLines).where(eq(orderLines.orderId, row.order.id));
      const hasItemLines = lines.some((l) => l.itemId);
      if (req.body.status === "confirmed" && hasItemLines && !warehouseId) {
        throw badRequest("Defina o armazém de origem para reservar o stock dos artigos");
      }
      if (req.body.status === "confirmed" && warehouseId) {
        await reserveOrderStock(app.db, req.user.tid, warehouseId, lines);
      }
      if (req.body.status === "cancelled" && row.order.warehouseId) {
        await releaseOrderStock(app.db, req.user.tid, row.order.warehouseId, lines);
      }

      const [updated] = await app.db
        .update(orders)
        .set({
          status: req.body.status,
          warehouseId: req.body.warehouseId !== undefined ? warehouseId : undefined,
          requestedDate: req.body.requestedDate === null ? null : (req.body.requestedDate ?? undefined),
          notes: req.body.notes === null ? null : (req.body.notes ?? undefined),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, row.order.id))
        .returning();
      await audit(app.db, {
        tenantId: req.user.tid,
        actorId: req.user.sub,
        action: req.body.status ? "orders.status_changed" : "orders.updated",
        entity: "order",
        entityId: updated.id,
        metadata: req.body,
        ip: req.ip,
      });
      if (req.body.status === "confirmed") {
        await notifyTenant(app.db, {
          tenantId: req.user.tid,
          trigger: "order.confirmed",
          title: `Encomenda ${updated.number} confirmada`,
          link: `/orders/${updated.id}`,
        });
      }
      return { order: orderToDto(updated, row.customerName, await warehouseName(updated.warehouseId)) };
    },
  );
};

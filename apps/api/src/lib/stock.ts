import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { DB } from "../db/client.js";
import {
  itemPickLocations,
  itemSerials,
  stockBinLevels,
  stockLevels,
  stockLots,
  stockMovements,
} from "../db/schema.js";
import { badRequest } from "./errors.js";

/**
 * Operações de stock por (tenant, armazém, artigo). Todas as atualizações são
 * condicionais numa única instrução SQL, para que dois pedidos concorrentes
 * não consigam consumir o mesmo stock.
 *
 * Disponível = em mão − reservado.
 */

const levelWhere = (tenantId: string, warehouseId: string, itemId: string) =>
  and(
    eq(stockLevels.tenantId, tenantId),
    eq(stockLevels.warehouseId, warehouseId),
    eq(stockLevels.itemId, itemId),
  );

/**
 * Atualiza o stock em mão (cria a linha se não existir). Para saídas, o
 * resultado não pode ficar negativo nem, com `respectReserved`, abaixo do reservado.
 */
export async function applyStockDelta(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  delta: number,
  opts: { respectReserved?: boolean; label?: string } = {},
) {
  if (delta >= 0) {
    const [level] = await db
      .insert(stockLevels)
      .values({ tenantId, warehouseId, itemId, onHand: delta })
      .onConflictDoUpdate({
        target: [stockLevels.tenantId, stockLevels.warehouseId, stockLevels.itemId],
        set: { onHand: sql`${stockLevels.onHand} + ${delta}`, updatedAt: new Date() },
      })
      .returning();
    return level;
  }
  const qty = -delta;
  const floor = opts.respectReserved ? sql`${stockLevels.reserved}` : sql`0`;
  const [level] = await db
    .update(stockLevels)
    .set({ onHand: sql`${stockLevels.onHand} - ${qty}`, updatedAt: new Date() })
    .where(and(levelWhere(tenantId, warehouseId, itemId), sql`${stockLevels.onHand} - ${qty} >= ${floor}`))
    .returning();
  if (!level) throw badRequest(opts.label ? `Stock insuficiente para ${opts.label}` : "Stock insuficiente");
  return level;
}

/** Reserva `qty` do stock disponível. */
export async function reserveStock(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  qty: number,
  label: string,
) {
  const [level] = await db
    .update(stockLevels)
    .set({ reserved: sql`${stockLevels.reserved} + ${qty}`, updatedAt: new Date() })
    .where(
      and(
        levelWhere(tenantId, warehouseId, itemId),
        sql`${stockLevels.onHand} - ${stockLevels.reserved} >= ${qty}`,
      ),
    )
    .returning();
  if (!level) throw badRequest(`Stock disponível insuficiente para ${label}`);
}

export async function releaseReservation(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  qty: number,
) {
  if (qty <= 0) return;
  await db
    .update(stockLevels)
    .set({ reserved: sql`greatest(${stockLevels.reserved} - ${qty}, 0)`, updatedAt: new Date() })
    .where(levelWhere(tenantId, warehouseId, itemId));
}

/**
 * Saída física de `qty`, consumindo primeiro `fromReserved` unidades reservadas;
 * o restante tem de existir como stock disponível.
 */
export async function issueStock(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  qty: number,
  fromReserved: number,
  label: string,
) {
  const r = Math.min(fromReserved, qty);
  const [level] = await db
    .update(stockLevels)
    .set({
      onHand: sql`${stockLevels.onHand} - ${qty}`,
      reserved: sql`${stockLevels.reserved} - ${r}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        levelWhere(tenantId, warehouseId, itemId),
        sql`${stockLevels.reserved} >= ${r}`,
        sql`${stockLevels.onHand} - ${stockLevels.reserved} >= ${qty - r}`,
      ),
    )
    .returning();
  if (!level) throw badRequest(`Stock insuficiente para expedir ${label}`);
}

export async function recordMovement(
  db: DB,
  m: {
    tenantId: string;
    type: "in" | "out" | "adjust" | "transfer";
    itemId: string;
    quantity: number;
    warehouseId: string;
    reference: string;
    note?: string;
    lotCode?: string | null;
    locationId?: string | null;
    createdBy?: string | null;
  },
) {
  await db.insert(stockMovements).values({
    tenantId: m.tenantId,
    type: m.type,
    itemId: m.itemId,
    quantity: m.quantity,
    warehouseId: m.warehouseId,
    reference: m.reference,
    note: m.note ?? null,
    lotCode: m.lotCode ?? null,
    locationId: m.locationId ?? null,
    createdBy: m.createdBy ?? null,
  });
}

// ── Lotes ───────────────────────────────────────────────────────────────────

/** Entrada de `qty` no lote (cria o lote se não existir). */
export async function applyLotDelta(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  code: string,
  qty: number,
  expiresAt?: string | null,
) {
  const [lot] = await db
    .insert(stockLots)
    .values({ tenantId, warehouseId, itemId, code, expiresAt: expiresAt ?? null, onHand: qty })
    .onConflictDoUpdate({
      target: [stockLots.tenantId, stockLots.warehouseId, stockLots.itemId, stockLots.code],
      set: {
        onHand: sql`${stockLots.onHand} + ${qty}`,
        ...(expiresAt ? { expiresAt } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  return lot;
}

/**
 * Consome `qty` dos lotes por ordem FEFO (validade mais próxima primeiro;
 * lotes sem validade por último). Devolve as quantidades consumidas por lote.
 */
export async function consumeLotsFefo(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  qty: number,
) {
  const lots = await db
    .select()
    .from(stockLots)
    .where(
      and(
        eq(stockLots.tenantId, tenantId),
        eq(stockLots.warehouseId, warehouseId),
        eq(stockLots.itemId, itemId),
        gt(stockLots.onHand, 0),
      ),
    )
    // FEFO: expires_at ASC com NULLs por último
    .orderBy(sql`${stockLots.expiresAt} ASC NULLS LAST`, asc(stockLots.code));
  let remaining = qty;
  const consumed: { code: string; qty: number; expiresAt: string | null }[] = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.onHand);
    await db
      .update(stockLots)
      .set({ onHand: sql`${stockLots.onHand} - ${take}`, updatedAt: new Date() })
      .where(eq(stockLots.id, lot.id));
    consumed.push({ code: lot.code, qty: take, expiresAt: lot.expiresAt });
    remaining -= take;
  }
  return consumed;
}

// ── Stock por bin ───────────────────────────────────────────────────────────

const binWhere = (tenantId: string, locationId: string, itemId: string) =>
  and(
    eq(stockBinLevels.tenantId, tenantId),
    eq(stockBinLevels.locationId, locationId),
    eq(stockBinLevels.itemId, itemId),
  );

/** Entrada de `qty` no bin (cria a linha se não existir). */
export async function applyBinDelta(
  db: DB,
  tenantId: string,
  warehouseId: string,
  locationId: string,
  itemId: string,
  qty: number,
  opts: { label?: string } = {},
) {
  if (qty >= 0) {
    const [bin] = await db
      .insert(stockBinLevels)
      .values({ tenantId, warehouseId, locationId, itemId, onHand: qty })
      .onConflictDoUpdate({
        target: [stockBinLevels.tenantId, stockBinLevels.locationId, stockBinLevels.itemId],
        set: { onHand: sql`${stockBinLevels.onHand} + ${qty}`, updatedAt: new Date() },
      })
      .returning();
    return bin;
  }
  const [bin] = await db
    .update(stockBinLevels)
    .set({ onHand: sql`${stockBinLevels.onHand} + ${qty}`, updatedAt: new Date() })
    .where(and(binWhere(tenantId, locationId, itemId), sql`${stockBinLevels.onHand} >= ${-qty}`))
    .returning();
  if (!bin) {
    throw badRequest(opts.label ? `Stock insuficiente no bin para ${opts.label}` : "Stock insuficiente no bin");
  }
  return bin;
}

/**
 * Consome `qty` dos bins do armazém — primeiro da localização preferencial de
 * picking do artigo, depois dos restantes por código de zona/localização.
 */
export async function consumeBins(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  qty: number,
  preferredLocationId?: string | null,
) {
  const bins = await db
    .select()
    .from(stockBinLevels)
    .where(
      and(
        eq(stockBinLevels.tenantId, tenantId),
        eq(stockBinLevels.warehouseId, warehouseId),
        eq(stockBinLevels.itemId, itemId),
        gt(stockBinLevels.onHand, 0),
      ),
    );
  if (!bins.length) return [];
  const preferred =
    preferredLocationId ??
    (
      await db
        .select({ locationId: itemPickLocations.locationId })
        .from(itemPickLocations)
        .where(
          and(
            eq(itemPickLocations.tenantId, tenantId),
            eq(itemPickLocations.warehouseId, warehouseId),
            eq(itemPickLocations.itemId, itemId),
          ),
        )
    )[0]?.locationId ??
    null;
  const sorted = [...bins].sort((a, b) =>
    a.locationId === preferred ? -1 : b.locationId === preferred ? 1 : 0,
  );
  let remaining = qty;
  const consumed: { locationId: string; qty: number }[] = [];
  for (const bin of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, bin.onHand);
    await db
      .update(stockBinLevels)
      .set({ onHand: sql`${stockBinLevels.onHand} - ${take}`, updatedAt: new Date() })
      .where(eq(stockBinLevels.id, bin.id));
    consumed.push({ locationId: bin.locationId, qty: take });
    remaining -= take;
  }
  return consumed;
}

// ── Números de série ────────────────────────────────────────────────────────

/** Regista séries na entrada. Rejeita duplicados e séries já existentes. */
export async function registerSerials(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  serials: string[],
) {
  const unique = [...new Set(serials.map((s) => s.trim()))];
  const existing = await db
    .select({ serial: itemSerials.serial })
    .from(itemSerials)
    .where(
      and(
        eq(itemSerials.tenantId, tenantId),
        eq(itemSerials.itemId, itemId),
        inArray(itemSerials.serial, unique),
      ),
    );
  if (existing.length) {
    throw badRequest(`Séries já registadas: ${existing.map((e) => e.serial).join(", ")}`);
  }
  if (unique.length) {
    await db.insert(itemSerials).values(
      unique.map((serial) => ({ tenantId, itemId, warehouseId, serial })),
    );
  }
}

/** Marca séries explícitas como saídas (saídas manuais). */
export async function issueSerials(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  serials: string[],
) {
  const rows = await db
    .select()
    .from(itemSerials)
    .where(
      and(
        eq(itemSerials.tenantId, tenantId),
        eq(itemSerials.itemId, itemId),
        eq(itemSerials.warehouseId, warehouseId),
        eq(itemSerials.status, "in_stock"),
        inArray(itemSerials.serial, serials.map((s) => s.trim())),
      ),
    );
  if (rows.length !== new Set(serials.map((s) => s.trim())).size) {
    const found = new Set(rows.map((r) => r.serial));
    const missing = serials.filter((s) => !found.has(s.trim()));
    throw badRequest(`Séries indisponíveis neste armazém: ${missing.join(", ")}`);
  }
  await db
    .update(itemSerials)
    .set({ status: "issued", updatedAt: new Date() })
    .where(inArray(itemSerials.id, rows.map((r) => r.id)));
}

/** Repõe séries saídas em stock (devoluções de clientes). */
export async function returnSerials(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  serials: string[],
) {
  const unique = [...new Set(serials.map((s) => s.trim()))];
  const rows = await db
    .select()
    .from(itemSerials)
    .where(
      and(
        eq(itemSerials.tenantId, tenantId),
        eq(itemSerials.itemId, itemId),
        eq(itemSerials.status, "issued"),
        inArray(itemSerials.serial, unique),
      ),
    );
  if (rows.length !== unique.length) {
    const found = new Set(rows.map((r) => r.serial));
    const bad = unique.filter((s) => !found.has(s));
    throw badRequest(`Séries desconhecidas ou não expedidas: ${bad.join(", ")}`);
  }
  await db
    .update(itemSerials)
    .set({ status: "in_stock", warehouseId, updatedAt: new Date() })
    .where(inArray(itemSerials.id, rows.map((r) => r.id)));
}

/** Consome automaticamente as primeiras `qty` séries em stock (expedições). */
export async function issueSerialsAuto(
  db: DB,
  tenantId: string,
  warehouseId: string,
  itemId: string,
  qty: number,
) {
  const rows = await db
    .select()
    .from(itemSerials)
    .where(
      and(
        eq(itemSerials.tenantId, tenantId),
        eq(itemSerials.itemId, itemId),
        eq(itemSerials.warehouseId, warehouseId),
        eq(itemSerials.status, "in_stock"),
      ),
    )
    .orderBy(asc(itemSerials.serial))
    .limit(qty);
  if (!rows.length) return [] as string[];
  await db
    .update(itemSerials)
    .set({ status: "issued", updatedAt: new Date() })
    .where(inArray(itemSerials.id, rows.map((r) => r.id)));
  return rows.map((r) => r.serial);
}

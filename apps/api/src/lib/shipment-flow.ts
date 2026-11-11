import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { SHIPMENT_TRANSITIONS, type ShipmentStatus } from "@transitum/shared";
import {
  items,
  itemSerials,
  orderLines,
  orders,
  shipmentCosts,
  shipmentEvents,
  shipmentLines,
  shipments,
  stockMovements,
  tenants,
  warehouseLocations,
} from "../db/schema.js";
import { env } from "../env.js";
import { audit } from "./audit.js";
import { badRequest } from "./errors.js";
import { notifyTenant } from "./notify.js";
import { applyRateCost } from "./rating.js";
import {
  applyBinDelta,
  applyStockDelta,
  consumeBins,
  consumeLotsFefo,
  issueSerialsAuto,
  issueStock,
  recordMovement,
  reserveStock,
} from "./stock.js";
import { toE164 } from "./messaging.js";

type ShipmentRow = typeof shipments.$inferSelect;

export interface Actor {
  tenantId: string;
  userId: string | null;
  name: string | null;
  ip?: string;
}

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft: "Rascunho",
  planned: "Planeada",
  in_transit: "Em trânsito",
  delivered: "Entregue",
  cancelled: "Cancelada",
};

/** Linhas da expedição que movimentam stock (ligadas a linhas de encomenda com artigo). */
async function stockLines(app: FastifyInstance, s: ShipmentRow) {
  return app.db
    .select({ sl: shipmentLines, ol: orderLines })
    .from(shipmentLines)
    .innerJoin(orderLines, eq(shipmentLines.orderLineId, orderLines.id))
    .where(and(eq(shipmentLines.shipmentId, s.id), isNotNull(orderLines.itemId)));
}

async function orderWarehouse(app: FastifyInstance, s: ShipmentRow) {
  if (!s.orderId) return null;
  const [o] = await app.db.select().from(orders).where(eq(orders.id, s.orderId));
  return o ?? null;
}

/** Saída de stock ao entrar em trânsito: consome a reserva da encomenda. */
async function issueShipmentStock(app: FastifyInstance, s: ShipmentRow, actor: Actor) {
  const lines = await stockLines(app, s);
  if (lines.length === 0) return;
  const order = await orderWarehouse(app, s);
  if (!order?.warehouseId) throw badRequest("A encomenda não tem armazém de origem definido");

  const done: {
    itemId: string;
    qty: number;
    fromReserved: number;
    olId: string;
    lots: { code: string; qty: number }[];
    bins: { locationId: string; code: string; qty: number }[];
    serials: string[];
  }[] = [];
  try {
    for (const { sl, ol } of lines) {
      const fromReserved = Math.min(ol.reservedQty, sl.quantity);
      await issueStock(app.db, s.tenantId, order.warehouseId, ol.itemId!, sl.quantity, fromReserved, sl.description);
      await app.db
        .update(orderLines)
        .set({ reservedQty: sql`${orderLines.reservedQty} - ${fromReserved}` })
        .where(eq(orderLines.id, ol.id));
      // FEFO: consome os lotes com validade mais próxima para rastreabilidade
      const lots = await consumeLotsFefo(app.db, s.tenantId, order.warehouseId, ol.itemId!, sl.quantity);
      // Bins: consome da localização preferencial de picking (registado na nota
      // para reposição exata no cancelamento)
      const consumed = await consumeBins(app.db, s.tenantId, order.warehouseId, ol.itemId!, sl.quantity);
      let bins: { locationId: string; code: string; qty: number }[] = [];
      if (consumed.length) {
        const locs = await app.db
          .select({ id: warehouseLocations.id, code: warehouseLocations.code })
          .from(warehouseLocations)
          .where(inArray(warehouseLocations.id, consumed.map((c) => c.locationId)));
        const codeById = new Map(locs.map((l) => [l.id, l.code]));
        bins = consumed.map((c) => ({ ...c, code: codeById.get(c.locationId) ?? "?" }));
      }
      // Artigos serializados: consome as primeiras `qty` séries em stock
      const [it] = await app.db
        .select({ serialized: items.serialized })
        .from(items)
        .where(eq(items.id, ol.itemId!));
      const serials = it?.serialized
        ? await issueSerialsAuto(app.db, s.tenantId, order.warehouseId, ol.itemId!, sl.quantity)
        : [];
      if (it?.serialized && serials.length < sl.quantity) {
        throw badRequest(
          `Séries em falta para ${sl.description}: ${sl.quantity - serials.length} unidade(s) sem série registada`,
        );
      }
      done.push({ itemId: ol.itemId!, qty: sl.quantity, fromReserved, olId: ol.id, lots, bins, serials });
    }
  } catch (err) {
    // Compensação manual das saídas já feitas (sem transação no driver PGlite)
    for (const d of done) {
      await applyStockDelta(app.db, s.tenantId, order.warehouseId, d.itemId, d.qty);
      if (d.fromReserved > 0) {
        await reserveStock(app.db, s.tenantId, order.warehouseId, d.itemId, d.fromReserved, "reposição");
        await app.db
          .update(orderLines)
          .set({ reservedQty: sql`${orderLines.reservedQty} + ${d.fromReserved}` })
          .where(eq(orderLines.id, d.olId));
      }
    }
    throw err;
  }
  for (const d of done) {
    await recordMovement(app.db, {
      tenantId: s.tenantId,
      type: "out",
      itemId: d.itemId,
      quantity: d.qty,
      warehouseId: order.warehouseId,
      reference: s.number,
      note: `Saída automática (expedição em trânsito)${d.lots.length ? ` — lotes FEFO: ${d.lots.map((l) => `${l.code}×${l.qty}`).join(", ")}` : ""}${d.bins.length ? ` — bins: ${d.bins.map((b) => `${b.code}×${b.qty}`).join(", ")}` : ""}${d.serials.length ? ` — séries: ${d.serials.join(", ")}` : ""}`,
      lotCode: d.lots[0]?.code ?? null,
      locationId: d.bins[0]?.locationId ?? null,
      createdBy: actor.userId,
    });
  }
  await app.db.insert(shipmentEvents).values({
    tenantId: s.tenantId,
    shipmentId: s.id,
    type: "stock",
    description: `Saída de stock: ${done.reduce((a, d) => a + d.qty, 0)} unidade(s) de ${done.length} artigo(s)`,
    createdBy: actor.userId,
  });
}

/** Ao cancelar: liberta as quantidades da encomenda e devolve stock já saído. */
async function revertShipmentLines(app: FastifyInstance, s: ShipmentRow, actor: Actor) {
  const linked = await app.db
    .select({ sl: shipmentLines, ol: orderLines })
    .from(shipmentLines)
    .innerJoin(orderLines, eq(shipmentLines.orderLineId, orderLines.id))
    .where(eq(shipmentLines.shipmentId, s.id));
  if (linked.length === 0) return;
  const order = await orderWarehouse(app, s);
  // Movimentos `out` já consumidos nesta reversão (linhas com mesmo artigo+qty)
  const usedMovements = new Set<string>();
  for (const { sl, ol } of linked) {
    await app.db
      .update(orderLines)
      .set({ shippedQty: sql`greatest(${orderLines.shippedQty} - ${sl.quantity}, 0)` })
      .where(eq(orderLines.id, ol.id));
    if (s.stockIssuedAt && ol.itemId && order?.warehouseId) {
      await applyStockDelta(app.db, s.tenantId, order.warehouseId, ol.itemId, sl.quantity);
      // Repõe bins e séries exatas da saída — registados na nota do movimento
      const outMovs = await app.db
        .select({ id: stockMovements.id, note: stockMovements.note })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.tenantId, s.tenantId),
            eq(stockMovements.type, "out"),
            eq(stockMovements.itemId, ol.itemId),
            eq(stockMovements.warehouseId, order.warehouseId),
            eq(stockMovements.reference, s.number),
            eq(stockMovements.quantity, sl.quantity),
          ),
        )
        .orderBy(desc(stockMovements.createdAt));
      const outMov = outMovs.find((m) => !usedMovements.has(m.id));
      if (outMov) usedMovements.add(outMov.id);
      const note = outMov?.note ?? "";
      const noteSerials = /séries: ([^—]+)/.exec(note)?.[1]?.split(",").map((v) => v.trim()).filter(Boolean);
      const noteBins = /bins: ([^—]+)/.exec(note)?.[1];

      // Séries: repõe as exatas da saída (ou as últimas saídas como fallback)
      const [it] = await app.db
        .select({ serialized: items.serialized })
        .from(items)
        .where(eq(items.id, ol.itemId));
      let returned: string[] = [];
      if (it?.serialized) {
        let issued: { id: string; serial: string }[] = [];
        if (noteSerials?.length) {
          issued = await app.db
            .select({ id: itemSerials.id, serial: itemSerials.serial })
            .from(itemSerials)
            .where(
              and(
                eq(itemSerials.tenantId, s.tenantId),
                eq(itemSerials.itemId, ol.itemId),
                eq(itemSerials.warehouseId, order.warehouseId),
                eq(itemSerials.status, "issued"),
                inArray(itemSerials.serial, noteSerials),
              ),
            );
        }
        if (!issued.length) {
          issued = await app.db
            .select({ id: itemSerials.id, serial: itemSerials.serial })
            .from(itemSerials)
            .where(
              and(
                eq(itemSerials.tenantId, s.tenantId),
                eq(itemSerials.itemId, ol.itemId),
                eq(itemSerials.warehouseId, order.warehouseId),
                eq(itemSerials.status, "issued"),
              ),
            )
            .orderBy(desc(itemSerials.updatedAt))
            .limit(sl.quantity);
        }
        if (issued.length) {
          await app.db
            .update(itemSerials)
            .set({ status: "in_stock", updatedAt: new Date() })
            .where(inArray(itemSerials.id, issued.map((r) => r.id)));
          returned = issued.map((r) => r.serial);
        }
      }

      // Bins: repõe nas localizações exatas consumidas na saída
      let restoredBins: string[] = [];
      if (noteBins) {
        const parts = noteBins.split(",").map((p) => {
          const m = /(.+?)\s*×\s*(\d+)\s*$/.exec(p.trim());
          return m ? { code: m[1].trim(), qty: Number(m[2]) } : null;
        });
        const codes = parts.filter((p): p is { code: string; qty: number } => !!p && p.qty > 0);
        if (codes.length) {
          const locs = await app.db
            .select({ id: warehouseLocations.id, code: warehouseLocations.code })
            .from(warehouseLocations)
            .where(
              and(
                eq(warehouseLocations.tenantId, s.tenantId),
                eq(warehouseLocations.warehouseId, order.warehouseId),
                inArray(warehouseLocations.code, codes.map((c) => c.code)),
              ),
            );
          const locByCode = new Map(locs.map((l) => [l.code, l.id]));
          for (const c of codes) {
            const locId = locByCode.get(c.code);
            if (!locId) continue;
            await applyBinDelta(app.db, s.tenantId, order.warehouseId, locId, ol.itemId, c.qty);
            restoredBins.push(`${c.code}×${c.qty}`);
          }
        }
      }

      await recordMovement(app.db, {
        tenantId: s.tenantId,
        type: "in",
        itemId: ol.itemId,
        quantity: sl.quantity,
        warehouseId: order.warehouseId,
        reference: s.number,
        note: `Devolução ao stock (expedição cancelada)${restoredBins.length ? ` — bins: ${restoredBins.join(", ")}` : ""}${returned.length ? ` — séries: ${returned.join(", ")}` : ""}`,
        createdBy: actor.userId,
      });
      if (order.status === "confirmed") {
        await reserveStock(app.db, s.tenantId, order.warehouseId, ol.itemId, sl.quantity, sl.description);
        await app.db
          .update(orderLines)
          .set({ reservedQty: sql`${orderLines.reservedQty} + ${sl.quantity}` })
          .where(eq(orderLines.id, ol.id));
      }
    }
  }
}

const RECIPIENT_MESSAGES: Partial<Record<ShipmentStatus | "out_for_delivery", string>> = {
  planned: "foi preparada para envio",
  in_transit: "está a caminho",
  out_for_delivery: "está em distribuição e será entregue em breve",
  delivered: "foi entregue",
};

export const trackingUrl = (token: string | null) =>
  token ? `${env.WEB_BASE_URL.replace(/\/$/, "")}/track/${token}` : null;

/** Email/SMS ao destinatário com link de tracking. Falhas ficam na timeline, não bloqueiam. */
export async function notifyRecipient(
  app: FastifyInstance,
  s: ShipmentRow,
  kind: ShipmentStatus | "out_for_delivery",
) {
  const message = RECIPIENT_MESSAGES[kind];
  if (!message || !s.notifyRecipient || (!s.recipientEmail && !s.recipientPhone)) return;
  const [tenant] = await app.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, s.tenantId));
  const url = trackingUrl(s.trackingToken);
  const greeting = s.recipientName ? `Olá ${s.recipientName},` : "Olá,";
  const text = `${greeting}\n\nA sua encomenda ${s.number} de ${tenant?.name ?? "Transitum"} ${message}.${url ? `\nAcompanhe em: ${url}` : ""}\n`;
  const channels: string[] = [];
  const failures: string[] = [];
  if (s.recipientEmail) {
    try {
      await app.mailer.send(s.recipientEmail, `Encomenda ${s.number}: ${SHIPMENT_STATUS_LABELS[kind as ShipmentStatus] ?? "Em distribuição"}`, text);
      channels.push("email");
    } catch (err) {
      app.log.warn({ err }, "falha no email ao destinatário");
      failures.push("email");
    }
  }
  if (s.recipientPhone) {
    try {
      const sms = `${tenant?.name ?? "Transitum"}: encomenda ${s.number} ${message}.${url ? ` ${url}` : ""}`;
      await app.sms.send(toE164(s.recipientPhone), sms.slice(0, 300));
      channels.push("SMS");
    } catch (err) {
      app.log.warn({ err }, "falha no SMS ao destinatário");
      failures.push("SMS");
    }
  }
  await app.db.insert(shipmentEvents).values({
    tenantId: s.tenantId,
    shipmentId: s.id,
    type: "notification",
    description: channels.length
      ? `Destinatário notificado (${channels.join(" + ")})${failures.length ? ` — falhou: ${failures.join(", ")}` : ""}`
      : `Falha ao notificar o destinatário (${failures.join(", ")})`,
  });
}

/**
 * Transição de estado de uma expedição — ponto único usado pelo backoffice,
 * pela app do motorista, pelas rotas e pelo tracking das transportadoras.
 */
export async function changeShipmentStatus(
  app: FastifyInstance,
  actor: Actor,
  s: ShipmentRow,
  next: ShipmentStatus,
  opts: { note?: string; location?: string; source?: string } = {},
) {
  const allowed = SHIPMENT_TRANSITIONS[s.status as ShipmentStatus] ?? [];
  if (!allowed.includes(next)) {
    throw badRequest(
      `Transição inválida: ${SHIPMENT_STATUS_LABELS[s.status as ShipmentStatus]} → ${SHIPMENT_STATUS_LABELS[next]}`,
    );
  }

  let stockIssuedAt: Date | undefined;
  if (next === "in_transit" && !s.stockIssuedAt) {
    await issueShipmentStock(app, s, actor);
    stockIssuedAt = new Date();
  }
  if (next === "cancelled") await revertShipmentLines(app, s, actor);

  const [updated] = await app.db
    .update(shipments)
    .set({
      status: next,
      deliveredAt: next === "delivered" ? new Date() : undefined,
      stockIssuedAt: next === "cancelled" ? null : stockIssuedAt,
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, s.id))
    .returning();

  const [event] = await app.db
    .insert(shipmentEvents)
    .values({
      tenantId: actor.tenantId,
      shipmentId: s.id,
      type: "status",
      status: next,
      description: opts.note ?? `Estado: ${SHIPMENT_STATUS_LABELS[next]}${opts.source ? ` (${opts.source})` : ""}`,
      location: opts.location ?? null,
      createdBy: actor.userId,
    })
    .returning();
  await audit(app.db, {
    tenantId: actor.tenantId,
    actorId: actor.userId,
    action: "shipments.status_changed",
    entity: "shipment",
    entityId: s.id,
    metadata: { from: s.status, to: next, source: opts.source ?? "backoffice" },
    ip: actor.ip,
  });
  await notifyTenant(app.db, {
    tenantId: actor.tenantId,
    trigger: "shipment.status_changed",
    title: `Expedição ${s.number}: ${SHIPMENT_STATUS_LABELS[next]}`,
    link: `/shipments/${s.id}`,
  });
  if (next === "delivered") {
    await notifyTenant(app.db, {
      tenantId: actor.tenantId,
      trigger: "shipment.delivered",
      title: `Expedição ${s.number} entregue`,
      link: `/shipments/${s.id}`,
    });
  }

  // Custo de frete automático ao planear (se ainda não existir nenhum)
  if (next === "planned" && updated.carrierId) {
    const [existing] = await app.db
      .select({ id: shipmentCosts.id })
      .from(shipmentCosts)
      .where(and(eq(shipmentCosts.shipmentId, s.id), eq(shipmentCosts.type, "freight")));
    if (!existing) await applyRateCost(app.db, updated, { actorId: actor.userId });
  }

  await notifyRecipient(app, updated, next);
  return { shipment: updated, event };
}

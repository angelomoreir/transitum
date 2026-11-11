import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import type { RateQuoteDto } from "@transitum/shared";
import type { DB } from "../db/client.js";
import { carrierRates, partners, shipmentCosts, shipments } from "../db/schema.js";

type ShipmentRow = typeof shipments.$inferSelect;
type RateRow = typeof carrierRates.$inferSelect;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Calcula o preço de uma tarifa para uma expedição (null + motivo se faltar dado). */
export function priceRate(
  rate: Pick<RateRow, "basis" | "price" | "minCharge">,
  s: Pick<ShipmentRow, "totalWeightKg" | "distanceKm" | "packages">,
): { amount: number | null; minChargeApplied: boolean; missing: RateQuoteDto["missing"] } {
  let raw: number;
  switch (rate.basis) {
    case "flat":
      raw = rate.price;
      break;
    case "per_kg":
      if (s.totalWeightKg == null) return { amount: null, minChargeApplied: false, missing: "weight" };
      raw = rate.price * s.totalWeightKg;
      break;
    case "per_km":
      if (s.distanceKm == null) return { amount: null, minChargeApplied: false, missing: "distance" };
      raw = rate.price * s.distanceKm;
      break;
    case "per_package":
      if (s.packages == null) return { amount: null, minChargeApplied: false, missing: "packages" };
      raw = rate.price * s.packages;
      break;
  }
  const min = rate.minCharge ?? 0;
  return raw < min
    ? { amount: round2(min), minChargeApplied: true, missing: null }
    : { amount: round2(raw), minChargeApplied: false, missing: null };
}

/**
 * Cotações de todas as tarifas ativas e em vigor (opcionalmente de uma só
 * transportadora), ordenadas do mais barato para o mais caro.
 */
export async function quoteShipment(
  db: DB,
  s: ShipmentRow,
  opts: { carrierId?: string | null; at?: Date } = {},
): Promise<RateQuoteDto[]> {
  const day = (opts.at ?? new Date()).toISOString().slice(0, 10);
  const conditions = [
    eq(carrierRates.tenantId, s.tenantId),
    eq(carrierRates.active, true),
    eq(partners.active, true),
    or(isNull(carrierRates.validFrom), lte(carrierRates.validFrom, day))!,
    or(isNull(carrierRates.validTo), gte(carrierRates.validTo, day))!,
  ];
  if (opts.carrierId) conditions.push(eq(carrierRates.carrierId, opts.carrierId));
  const rows = await db
    .select({ rate: carrierRates, carrierName: partners.name })
    .from(carrierRates)
    .innerJoin(partners, eq(carrierRates.carrierId, partners.id))
    .where(and(...conditions));

  return rows
    .map(({ rate, carrierName }) => ({
      rateId: rate.id,
      rateName: rate.name,
      carrierId: rate.carrierId,
      carrierName,
      basis: rate.basis,
      currency: rate.currency,
      ...priceRate(rate, s),
    }))
    .sort((a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity));
}

/**
 * Regista o custo de frete a partir de uma tarifa (a indicada ou a mais barata
 * da transportadora da expedição). Devolve null se não houver tarifa aplicável.
 */
export async function applyRateCost(
  db: DB,
  s: ShipmentRow,
  opts: { rateId?: string; actorId?: string | null } = {},
) {
  const quotes = await quoteShipment(db, s, { carrierId: opts.rateId ? undefined : s.carrierId });
  const quote = opts.rateId
    ? quotes.find((q) => q.rateId === opts.rateId)
    : quotes.find((q) => q.amount != null);
  if (!quote || quote.amount == null) return { cost: null, quote: quote ?? null };
  const [cost] = await db
    .insert(shipmentCosts)
    .values({
      tenantId: s.tenantId,
      shipmentId: s.id,
      type: "freight",
      description: `${quote.carrierName} — ${quote.rateName}${quote.minChargeApplied ? " (mínimo)" : ""}`,
      amount: quote.amount,
      currency: quote.currency,
      rateId: quote.rateId,
      createdBy: opts.actorId ?? null,
    })
    .returning();
  return { cost, quote };
}

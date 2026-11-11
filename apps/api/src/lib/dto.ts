import type { CustomsStatus, Incoterm } from "@transitum/shared";
import type { orderLines, orders, shipmentCosts, shipments, transportDocuments } from "../db/schema.js";
import { coordsOf } from "./geo.js";

type ShipmentRow = typeof shipments.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

/** Fator de emissão rodoviário: kg CO₂e por tonelada-quilómetro (DEFRA ~0,096) */
const CO2_KG_PER_TONNE_KM = 0.096;

/** kg CO₂e estimados: distância × peso × fator; null sem distância ou peso */
export function estimatedCo2Kg(s: Pick<ShipmentRow, "distanceKm" | "totalWeightKg">) {
  if (s.distanceKm == null || s.totalWeightKg == null || s.totalWeightKg <= 0) return null;
  return Math.round(s.distanceKm * (s.totalWeightKg / 1000) * CO2_KG_PER_TONNE_KM * 100) / 100;
}

export function shipmentToDto(
  s: ShipmentRow,
  names: { customerName?: string | null; carrierName?: string | null; orderNumber?: string | null } = {},
) {
  return {
    id: s.id,
    tenantId: s.tenantId,
    number: s.number,
    status: s.status,
    customerId: s.customerId,
    customerName: names.customerName ?? "",
    carrierId: s.carrierId ?? null,
    carrierName: names.carrierName ?? null,
    orderId: s.orderId ?? null,
    orderNumber: names.orderNumber ?? null,
    pickupAddress: {
      line1: s.pickupLine1,
      city: s.pickupCity,
      postalCode: s.pickupPostalCode,
      country: s.pickupCountry,
    },
    deliveryAddress: {
      line1: s.deliveryLine1,
      city: s.deliveryCity,
      postalCode: s.deliveryPostalCode,
      country: s.deliveryCountry,
    },
    plannedPickupAt: s.plannedPickupAt?.toISOString() ?? null,
    plannedDeliveryAt: s.plannedDeliveryAt?.toISOString() ?? null,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
    totalWeightKg: s.totalWeightKg ?? null,
    packages: s.packages ?? null,
    incoterm: (s.incoterm as Incoterm | null) ?? null,
    customsStatus: s.customsStatus as CustomsStatus,
    notes: s.notes ?? null,
    recipientName: s.recipientName ?? null,
    recipientEmail: s.recipientEmail ?? null,
    recipientPhone: s.recipientPhone ?? null,
    notifyRecipient: s.notifyRecipient,
    trackingToken: s.trackingToken ?? null,
    pickupCoords: coordsOf(s.pickupLat, s.pickupLng),
    deliveryCoords: coordsOf(s.deliveryLat, s.deliveryLng),
    distanceKm: s.distanceKm ?? null,
    vehicleRef: s.vehicleRef ?? null,
    stockIssuedAt: s.stockIssuedAt?.toISOString() ?? null,
    carrierProvider: s.carrierProvider ?? null,
    trackingNumber: s.trackingNumber ?? null,
    carrierBookedAt: s.carrierBookedAt?.toISOString() ?? null,
    estimatedCo2Kg: estimatedCo2Kg(s),
    createdAt: s.createdAt.toISOString(),
  };
}

export function orderToDto(o: OrderRow, customerName = "", warehouseName: string | null = null) {
  return {
    id: o.id,
    tenantId: o.tenantId,
    number: o.number,
    status: o.status,
    customerId: o.customerId,
    customerName,
    requestedDate: o.requestedDate ?? null,
    notes: o.notes ?? null,
    deliveryLine1: o.deliveryLine1 ?? null,
    deliveryCity: o.deliveryCity ?? null,
    deliveryPostalCode: o.deliveryPostalCode ?? null,
    deliveryCountry: o.deliveryCountry ?? null,
    warehouseId: o.warehouseId ?? null,
    warehouseName,
    createdAt: o.createdAt.toISOString(),
  };
}

export function orderLineToDto(
  l: typeof orderLines.$inferSelect,
  item: { sku: string; unit: string } | null = null,
) {
  return {
    id: l.id,
    lineNo: l.lineNo,
    description: l.description,
    quantity: l.quantity,
    weightKg: l.weightKg ?? null,
    itemId: l.itemId ?? null,
    sku: item?.sku ?? null,
    unit: item?.unit ?? null,
    unitPrice: l.unitPrice ?? null,
    reservedQty: l.reservedQty,
    shippedQty: l.shippedQty,
  };
}

export const orderTotal = (lines: { quantity: number; unitPrice: number | null }[]) =>
  Math.round(lines.reduce((sum, l) => sum + l.quantity * (l.unitPrice ?? 0), 0) * 100) / 100;

export const costToDto = (c: typeof shipmentCosts.$inferSelect) => ({
  id: c.id,
  type: c.type,
  description: c.description,
  amount: c.amount,
  currency: c.currency,
  rateId: c.rateId ?? null,
  createdAt: c.createdAt.toISOString(),
});

export const transportDocToDto = (d: typeof transportDocuments.$inferSelect) => ({
  id: d.id,
  docType: d.docType as "GT" | "GR",
  number: d.number,
  atcud: d.atcud,
  movementStartAt: d.movementStartAt.toISOString(),
  status: d.status,
  environment: d.environment ?? null,
  atDocCode: d.atDocCode ?? null,
  atMessage: d.atMessage ?? null,
  signed: !!d.hash,
  communicatedAt: d.communicatedAt?.toISOString() ?? null,
  createdAt: d.createdAt.toISOString(),
});

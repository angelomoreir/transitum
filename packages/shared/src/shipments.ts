import { z } from "zod";
import { shipmentCostDtoSchema } from "./costs.js";
import {
  customsItemDtoSchema,
  customsStatusSchema,
  incotermSchema,
} from "./trade.js";

export const SHIPMENT_STATUSES = [
  "draft",
  "planned",
  "in_transit",
  "delivered",
  "cancelled",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export const shipmentStatusSchema = z.enum(SHIPMENT_STATUSES);

/** Transições válidas de estado — também usadas no backend. */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  draft: ["planned", "cancelled"],
  planned: ["in_transit", "cancelled"],
  in_transit: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export const addressSchema = z.object({
  line1: z.string().trim().min(1).max(160),
  city: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().min(1).max(16),
  country: z.string().trim().length(2).toUpperCase(),
});
export type AddressInput = z.infer<typeof addressSchema>;

export const shipmentCreateSchema = z.object({
  customerId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
  carrierId: z.string().uuid().optional(),
  pickupAddress: addressSchema,
  deliveryAddress: addressSchema,
  plannedPickupAt: z.string().optional(),
  plannedDeliveryAt: z.string().optional(),
  totalWeightKg: z.coerce.number().min(0).optional(),
  packages: z.coerce.number().int().min(1).optional(),
  incoterm: incotermSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>;

export const shipmentUpdateSchema = z.object({
  carrierId: z.string().uuid().nullish(),
  plannedPickupAt: z.string().nullish(),
  plannedDeliveryAt: z.string().nullish(),
  totalWeightKg: z.coerce.number().min(0).nullish(),
  packages: z.coerce.number().int().min(1).nullish(),
  incoterm: incotermSchema.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type ShipmentUpdateInput = z.infer<typeof shipmentUpdateSchema>;

export const shipmentStatusUpdateSchema = z.object({
  status: z.enum(["planned", "in_transit", "delivered", "cancelled"]),
  note: z.string().trim().max(500).optional(),
});
export type ShipmentStatusUpdate = z.infer<typeof shipmentStatusUpdateSchema>;

export const shipmentEventCreateSchema = z.object({
  description: z.string().trim().min(1).max(500),
  location: z.string().trim().max(160).optional(),
});
export type ShipmentEventCreateInput = z.infer<typeof shipmentEventCreateSchema>;

export const shipmentEventDtoSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string().nullable(),
  description: z.string(),
  location: z.string().nullable(),
  actorName: z.string().nullable(),
  occurredAt: z.string(),
});
export type ShipmentEventDto = z.infer<typeof shipmentEventDtoSchema>;

export const shipmentDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  number: z.string(),
  status: shipmentStatusSchema,
  customerId: z.string(),
  customerName: z.string(),
  carrierId: z.string().nullable(),
  carrierName: z.string().nullable(),
  orderId: z.string().nullable(),
  orderNumber: z.string().nullable(),
  pickupAddress: addressSchema,
  deliveryAddress: addressSchema,
  plannedPickupAt: z.string().nullable(),
  plannedDeliveryAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  totalWeightKg: z.number().nullable(),
  packages: z.number().nullable(),
  incoterm: incotermSchema.nullable(),
  customsStatus: customsStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type ShipmentDto = z.infer<typeof shipmentDtoSchema>;

export const shipmentDetailDtoSchema = shipmentDtoSchema.extend({
  events: z.array(shipmentEventDtoSchema),
  costs: z.array(shipmentCostDtoSchema),
  customsItems: z.array(customsItemDtoSchema),
  totalCost: z.number(),
});
export type ShipmentDetailDto = z.infer<typeof shipmentDetailDtoSchema>;

export const listShipmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: shipmentStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
  carrierId: z.string().uuid().optional(),
});

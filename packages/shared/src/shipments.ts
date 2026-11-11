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

export const coordsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Coords = z.infer<typeof coordsSchema>;

export const addressSchema = z.object({
  line1: z.string().trim().min(1).max(160),
  city: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().min(1).max(16),
  country: z.string().trim().length(2).toUpperCase(),
});
export type AddressInput = z.infer<typeof addressSchema>;

/** Linha de mercadoria: da encomenda (`orderLineId`) ou livre (`description`). */
export const shipmentLineInputSchema = z
  .object({
    orderLineId: z.string().uuid().optional(),
    description: z.string().trim().max(200).optional(),
    quantity: z.coerce.number().int().min(1),
    unit: z.string().trim().min(1).max(12).optional(),
    weightKg: z.coerce.number().min(0).optional(),
    unitPrice: z.coerce.number().min(0).optional(),
  })
  .refine((l) => !!l.orderLineId || !!l.description, {
    message: "Cada linha precisa de uma linha de encomenda ou descrição",
    path: ["description"],
  });
export type ShipmentLineInput = z.infer<typeof shipmentLineInputSchema>;

const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^\+?[0-9 ()-]{6,}$/, "Telefone inválido");

const recipientFields = {
  recipientName: z.string().trim().max(120),
  recipientEmail: z.string().trim().toLowerCase().email().max(254),
  recipientPhone: phoneSchema,
};

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
  recipientName: recipientFields.recipientName.optional(),
  recipientEmail: recipientFields.recipientEmail.optional(),
  recipientPhone: recipientFields.recipientPhone.optional(),
  notifyRecipient: z.boolean().default(true),
  /** Distância manual (km); se omitida é estimada a partir das coordenadas */
  distanceKm: z.coerce.number().min(0).max(50_000).optional(),
  vehicleRef: z.string().trim().max(40).optional(),
  /** Omitido + orderId → todas as quantidades pendentes da encomenda */
  lines: z.array(shipmentLineInputSchema).max(200).optional(),
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
  recipientName: recipientFields.recipientName.nullish(),
  recipientEmail: recipientFields.recipientEmail.nullish(),
  recipientPhone: recipientFields.recipientPhone.nullish(),
  notifyRecipient: z.boolean().optional(),
  distanceKm: z.coerce.number().min(0).max(50_000).nullish(),
  vehicleRef: z.string().trim().max(40).nullish(),
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
  recipientName: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  recipientPhone: z.string().nullable(),
  notifyRecipient: z.boolean(),
  trackingToken: z.string().nullable(),
  pickupCoords: coordsSchema.nullable(),
  deliveryCoords: coordsSchema.nullable(),
  distanceKm: z.number().nullable(),
  vehicleRef: z.string().nullable(),
  stockIssuedAt: z.string().nullable(),
  carrierProvider: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  carrierBookedAt: z.string().nullable(),
  /** Estimativa de emissões (kg CO₂e) — distância × peso × fator rodoviário */
  estimatedCo2Kg: z.number().nullable(),
  createdAt: z.string(),
});
export type ShipmentDto = z.infer<typeof shipmentDtoSchema>;

export const shipmentLineDtoSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  orderLineId: z.string().nullable(),
  itemId: z.string().nullable(),
  sku: z.string().nullable(),
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  weightKg: z.number().nullable(),
  unitPrice: z.number().nullable(),
});
export type ShipmentLineDto = z.infer<typeof shipmentLineDtoSchema>;

export const TRANSPORT_DOC_TYPES = ["GT", "GR"] as const;
export type TransportDocType = (typeof TRANSPORT_DOC_TYPES)[number];

export const transportDocumentDtoSchema = z.object({
  id: z.string(),
  docType: z.enum(TRANSPORT_DOC_TYPES),
  number: z.string(),
  atcud: z.string(),
  movementStartAt: z.string(),
  status: z.enum(["issued", "communicated", "failed"]),
  environment: z.string().nullable(),
  atDocCode: z.string().nullable(),
  atMessage: z.string().nullable(),
  signed: z.boolean(),
  communicatedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type TransportDocumentDto = z.infer<typeof transportDocumentDtoSchema>;

export const proofOfDeliveryDtoSchema = z.object({
  id: z.string(),
  stopId: z.string(),
  stopType: z.string(),
  recipientName: z.string(),
  signatureDocId: z.string().nullable(),
  photoDocId: z.string().nullable(),
  coords: coordsSchema.nullable(),
  note: z.string().nullable(),
  capturedByName: z.string().nullable(),
  capturedAt: z.string(),
});
export type ProofOfDeliveryDto = z.infer<typeof proofOfDeliveryDtoSchema>;

export const positionDtoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().nullable(),
  recordedAt: z.string(),
});
export type PositionDto = z.infer<typeof positionDtoSchema>;

export const shipmentDetailDtoSchema = shipmentDtoSchema.extend({
  events: z.array(shipmentEventDtoSchema),
  costs: z.array(shipmentCostDtoSchema),
  customsItems: z.array(customsItemDtoSchema),
  totalCost: z.number(),
  lines: z.array(shipmentLineDtoSchema),
  transportDocuments: z.array(transportDocumentDtoSchema),
  proofs: z.array(proofOfDeliveryDtoSchema),
  /** Última posição GPS do motorista de uma rota ativa com esta expedição */
  lastPosition: positionDtoSchema.nullable(),
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

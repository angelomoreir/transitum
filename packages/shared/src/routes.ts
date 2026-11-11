import { z } from "zod";
import { addressSchema, coordsSchema } from "./shipments.js";

export const ROUTE_STATUSES = ["draft", "dispatched", "completed", "cancelled"] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];
export const routeStatusSchema = z.enum(ROUTE_STATUSES);

export const ROUTE_TRANSITIONS: Record<RouteStatus, RouteStatus[]> = {
  draft: ["dispatched", "cancelled"],
  dispatched: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const STOP_TYPES = ["pickup", "delivery"] as const;
export type StopType = (typeof STOP_TYPES)[number];
export const stopTypeSchema = z.enum(STOP_TYPES);

export const STOP_STATUSES = ["pending", "arrived", "done", "skipped"] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];
export const stopStatusSchema = z.enum(STOP_STATUSES);

export const STOP_TRANSITIONS: Record<StopStatus, StopStatus[]> = {
  pending: ["arrived", "done", "skipped"],
  arrived: ["done", "skipped"],
  done: [],
  skipped: [],
};

export const routeStopInputSchema = z.object({
  type: stopTypeSchema,
  shipmentId: z.string().uuid().optional(),
  address: addressSchema,
  plannedAt: z.string().optional(),
  note: z.string().trim().max(300).optional(),
});
export type RouteStopInput = z.infer<typeof routeStopInputSchema>;

export const routeCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  carrierId: z.string().uuid().optional(),
  driverName: z.string().trim().max(120).optional(),
  /** Utilizador com função "driver" — vê a rota na app móvel */
  driverUserId: z.string().uuid().optional(),
  /** Viatura da frota — preenche `vehicleRef` com a matrícula se omitido */
  vehicleId: z.string().uuid().optional(),
  vehicleRef: z.string().trim().max(40).optional(),
  plannedStartAt: z.string().optional(),
  plannedEndAt: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
  stops: z.array(routeStopInputSchema).max(50).default([]),
});
export type RouteCreateInput = z.infer<typeof routeCreateSchema>;

export const routeUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  carrierId: z.string().uuid().nullish(),
  driverName: z.string().trim().max(120).nullish(),
  driverUserId: z.string().uuid().nullish(),
  vehicleId: z.string().uuid().nullish(),
  vehicleRef: z.string().trim().max(40).nullish(),
  plannedStartAt: z.string().nullish(),
  plannedEndAt: z.string().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type RouteUpdateInput = z.infer<typeof routeUpdateSchema>;

export const routeStatusUpdateSchema = z.object({
  status: z.enum(["dispatched", "completed", "cancelled"]),
});
export type RouteStatusUpdate = z.infer<typeof routeStatusUpdateSchema>;

export const stopStatusUpdateSchema = z.object({
  status: z.enum(["arrived", "done", "skipped"]),
  note: z.string().trim().max(300).optional(),
});
export type StopStatusUpdate = z.infer<typeof stopStatusUpdateSchema>;

export const routeStopDtoSchema = z.object({
  id: z.string(),
  seq: z.number(),
  type: stopTypeSchema,
  status: stopStatusSchema,
  shipmentId: z.string().nullable(),
  shipmentNumber: z.string().nullable(),
  address: addressSchema,
  coords: coordsSchema.nullable(),
  hasProof: z.boolean(),
  plannedAt: z.string().nullable(),
  arrivedAt: z.string().nullable(),
  doneAt: z.string().nullable(),
  note: z.string().nullable(),
});
export type RouteStopDto = z.infer<typeof routeStopDtoSchema>;

export const routeDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  number: z.string(),
  name: z.string(),
  status: routeStatusSchema,
  carrierId: z.string().nullable(),
  carrierName: z.string().nullable(),
  driverName: z.string().nullable(),
  driverUserId: z.string().nullable(),
  vehicleId: z.string().nullable(),
  vehiclePlate: z.string().nullable(),
  vehicleRef: z.string().nullable(),
  plannedStartAt: z.string().nullable(),
  plannedEndAt: z.string().nullable(),
  notes: z.string().nullable(),
  stopCount: z.number(),
  doneStops: z.number(),
  createdAt: z.string(),
});
export type RouteDto = z.infer<typeof routeDtoSchema>;

export const routeDetailDtoSchema = routeDtoSchema.extend({
  stops: z.array(routeStopDtoSchema),
  /** Últimas posições GPS do motorista (mais recente primeiro) */
  positions: z.array(
    z.object({ lat: z.number(), lng: z.number(), recordedAt: z.string() }),
  ),
});
export type RouteDetailDto = z.infer<typeof routeDetailDtoSchema>;

export const listRoutesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: routeStatusSchema.optional(),
  carrierId: z.string().uuid().optional(),
});

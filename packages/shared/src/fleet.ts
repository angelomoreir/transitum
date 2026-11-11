import { z } from "zod";

// ---- Frota de viaturas ----

export const VEHICLE_TYPES = ["van", "truck", "car", "motorcycle", "other"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export const vehicleTypeSchema = z.enum(VEHICLE_TYPES);

export const vehicleCreateSchema = z.object({
  plate: z.string().trim().min(2).max(20).toUpperCase(),
  name: z.string().trim().min(2).max(80),
  type: vehicleTypeSchema.default("van"),
  capacityKg: z.coerce.number().min(0).max(1_000_000).optional(),
});
export type VehicleCreateInput = z.infer<typeof vehicleCreateSchema>;

export const vehicleUpdateSchema = vehicleCreateSchema.partial().extend({
  active: z.boolean().optional(),
});
export type VehicleUpdateInput = z.infer<typeof vehicleUpdateSchema>;

export const vehicleDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  plate: z.string(),
  name: z.string(),
  type: vehicleTypeSchema,
  capacityKg: z.number().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type VehicleDto = z.infer<typeof vehicleDtoSchema>;

export const listVehiclesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  q: z.string().trim().max(120).optional(),
  active: z.enum(["true", "false"]).optional(),
});

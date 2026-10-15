import { z } from "zod";

export const COST_TYPES = ["freight", "fuel", "tolls", "other"] as const;
export type CostType = (typeof COST_TYPES)[number];
export const costTypeSchema = z.enum(COST_TYPES);

export const RATE_BASES = ["flat", "per_kg", "per_km", "per_package"] as const;
export type RateBasis = (typeof RATE_BASES)[number];
export const rateBasisSchema = z.enum(RATE_BASES);

const money = z.coerce.number().min(0).max(1_000_000_000);

// ---- Tarifas de transportadora ----

export const rateCreateSchema = z.object({
  carrierId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  basis: rateBasisSchema,
  price: money,
  currency: z.string().trim().length(3).toUpperCase().default("EUR"),
  minCharge: money.optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});
export type RateCreateInput = z.infer<typeof rateCreateSchema>;

export const rateUpdateSchema = rateCreateSchema.partial().extend({
  active: z.boolean().optional(),
});
export type RateUpdateInput = z.infer<typeof rateUpdateSchema>;

export const rateDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  carrierId: z.string(),
  carrierName: z.string(),
  name: z.string(),
  basis: rateBasisSchema,
  price: z.number(),
  currency: z.string(),
  minCharge: z.number().nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  active: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type RateDto = z.infer<typeof rateDtoSchema>;

export const listRatesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  carrierId: z.string().uuid().optional(),
  active: z.coerce.boolean().optional(),
});

// ---- Custos de expedição ----

export const shipmentCostCreateSchema = z.object({
  type: costTypeSchema,
  description: z.string().trim().min(1).max(200),
  amount: z.coerce.number().min(0.01).max(1_000_000_000),
  currency: z.string().trim().length(3).toUpperCase().default("EUR"),
});
export type ShipmentCostCreateInput = z.infer<typeof shipmentCostCreateSchema>;

export const shipmentCostDtoSchema = z.object({
  id: z.string(),
  type: costTypeSchema,
  description: z.string(),
  amount: z.number(),
  currency: z.string(),
  createdAt: z.string(),
});
export type ShipmentCostDto = z.infer<typeof shipmentCostDtoSchema>;

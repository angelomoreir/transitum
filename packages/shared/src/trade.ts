import { z } from "zod";

// ── Comércio internacional / alfândega ─────────────────────────────────────

export const INCOTERMS = [
  "EXW",
  "FCA",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
  "FOB",
  "CFR",
  "CIF",
] as const;
export type Incoterm = (typeof INCOTERMS)[number];
export const incotermSchema = z.enum(INCOTERMS);

export const CUSTOMS_STATUSES = [
  "none",
  "prepared",
  "submitted",
  "cleared",
  "held",
] as const;
export type CustomsStatus = (typeof CUSTOMS_STATUSES)[number];
export const customsStatusSchema = z.enum(CUSTOMS_STATUSES);

/** Transições manuais do estado aduaneiro (qualquer estado pode voltar a held). */
export const CUSTOMS_TRANSITIONS: Record<CustomsStatus, CustomsStatus[]> = {
  none: ["prepared"],
  prepared: ["submitted", "none"],
  submitted: ["cleared", "held"],
  cleared: [],
  held: ["submitted"],
};

export const customsUpdateSchema = z.object({
  incoterm: incotermSchema.nullish(),
  customsStatus: z
    .enum(["prepared", "submitted", "cleared", "held", "none"])
    .optional(),
  note: z.string().trim().max(300).optional(),
});
export type CustomsUpdateInput = z.infer<typeof customsUpdateSchema>;

export const customsItemCreateSchema = z.object({
  description: z.string().trim().min(1).max(200),
  hsCode: z
    .string()
    .trim()
    .regex(/^\d{4,10}$/, "HS code: 4–10 dígitos")
    .optional(),
  originCountry: z.string().trim().length(2).toUpperCase().optional(),
  quantity: z.coerce.number().min(0).default(1),
  weightKg: z.coerce.number().min(0).optional(),
  value: z.coerce.number().min(0).optional(),
  currency: z.string().trim().length(3).toUpperCase().default("EUR"),
});
export type CustomsItemCreateInput = z.infer<typeof customsItemCreateSchema>;

export const customsItemDtoSchema = z.object({
  id: z.string(),
  description: z.string(),
  hsCode: z.string().nullable(),
  originCountry: z.string().nullable(),
  quantity: z.number(),
  weightKg: z.number().nullable(),
  value: z.number().nullable(),
  currency: z.string(),
});
export type CustomsItemDto = z.infer<typeof customsItemDtoSchema>;

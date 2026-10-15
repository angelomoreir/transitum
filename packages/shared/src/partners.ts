import { z } from "zod";

export const PARTNER_TYPES = ["customer", "supplier", "carrier"] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];
export const partnerTypeSchema = z.enum(PARTNER_TYPES);

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("")).transform((v) => v || undefined);
const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .optional()
  .or(z.literal(""))
  .transform((v) => v || undefined);

export const partnerCreateSchema = z.object({
  types: z.array(partnerTypeSchema).min(1, "Selecione pelo menos um tipo"),
  name: z.string().trim().min(2).max(160),
  taxId: optionalText(32),
  email: optionalEmail,
  phone: optionalText(32),
  addressLine1: optionalText(160),
  city: optionalText(80),
  postalCode: optionalText(16),
  country: z.string().trim().length(2).toUpperCase().default("PT"),
  notes: optionalText(2000),
});
export type PartnerCreateInput = z.infer<typeof partnerCreateSchema>;

export const partnerUpdateSchema = partnerCreateSchema.partial().extend({
  active: z.boolean().optional(),
});
export type PartnerUpdateInput = z.infer<typeof partnerUpdateSchema>;

export const partnerDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  code: z.string(),
  types: z.array(partnerTypeSchema),
  name: z.string(),
  taxId: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  addressLine1: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  active: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type PartnerDto = z.infer<typeof partnerDtoSchema>;

export const listPartnersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  type: partnerTypeSchema.optional(),
  active: z.coerce.boolean().optional(),
});

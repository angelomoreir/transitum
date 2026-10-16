import { z } from "zod";

// ── Chaves de API e webhooks ────────────────────────────────────────────────

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** Data de expiração opcional (ISO 8601) — chave deixa de autenticar após esta data */
  expiresAt: z.string().datetime().optional(),
});
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;

export const apiKeyDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  active: z.boolean(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});
export type ApiKeyDto = z.infer<typeof apiKeyDtoSchema>;

export const webhookDeliveryDtoSchema = z.object({
  id: z.string(),
  url: z.string(),
  trigger: z.string(),
  statusCode: z.number().nullable(),
  success: z.boolean(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type WebhookDeliveryDto = z.infer<typeof webhookDeliveryDtoSchema>;

import { z } from "zod";

// ── Documentos ──────────────────────────────────────────────────────────────

export const DOC_ENTITY_TYPES = [
  "shipment",
  "order",
  "purchase_order",
  "partner",
  "route",
] as const;
export type DocEntityType = (typeof DOC_ENTITY_TYPES)[number];
export const docEntityTypeSchema = z.enum(DOC_ENTITY_TYPES);

export const DOC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const documentCreateSchema = z.object({
  entityType: docEntityTypeSchema,
  entityId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(3).max(100).default("application/octet-stream"),
  contentBase64: z
    .string()
    .min(1)
    .refine((s) => Buffer.byteLength(s, "base64") <= DOC_MAX_BYTES, {
      message: "Ficheiro excede 5 MB",
    }),
});
export type DocumentCreateInput = z.infer<typeof documentCreateSchema>;

export const documentDtoSchema = z.object({
  id: z.string(),
  entityType: docEntityTypeSchema,
  entityId: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  uploadedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type DocumentDto = z.infer<typeof documentDtoSchema>;

export const listDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  entityType: docEntityTypeSchema.optional(),
  entityId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
});

// ── Notificações (DTO em api.ts: NotificationDto) ───────────────────────────

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  unread: z.enum(["true"]).optional(),
});

// ── Automatizações ──────────────────────────────────────────────────────────

export const AUTOMATION_TRIGGERS = [
  "shipment.status_changed",
  "shipment.delivered",
  "shipment.customs_cleared",
  "order.confirmed",
  "purchase_order.received",
  "route.completed",
  "document.uploaded",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];
export const automationTriggerSchema = z.enum(AUTOMATION_TRIGGERS);

export const AUTOMATION_ACTIONS = ["notify", "webhook"] as const;
export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];

export const automationCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    trigger: automationTriggerSchema,
    action: z.enum(AUTOMATION_ACTIONS).default("notify"),
    webhookUrl: z.string().trim().url().max(300).optional(),
    active: z.boolean().default(true),
  })
  .refine((v) => v.action !== "webhook" || !!v.webhookUrl, {
    message: "webhookUrl obrigatório para ação webhook",
    path: ["webhookUrl"],
  });
export type AutomationCreateInput = z.infer<typeof automationCreateSchema>;

export const automationUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  active: z.boolean().optional(),
});
export type AutomationUpdateInput = z.infer<typeof automationUpdateSchema>;

export const automationDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  trigger: automationTriggerSchema,
  action: z.enum(AUTOMATION_ACTIONS),
  webhookUrl: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type AutomationDto = z.infer<typeof automationDtoSchema>;

import { z } from "zod";

// ── Subscrições e faturação SaaS ────────────────────────────────────────────

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);

export const INVOICE_STATUSES = ["open", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const planDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  priceMonthly: z.number(),
  currency: z.string(),
  maxUsers: z.number(),
  maxApiKeys: z.number(),
  active: z.boolean(),
});
export type PlanDto = z.infer<typeof planDtoSchema>;

export const subscriptionDtoSchema = z.object({
  plan: planDtoSchema,
  status: subscriptionStatusSchema,
  trialEndsAt: z.string().nullable(),
  currentPeriodStart: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type SubscriptionDto = z.infer<typeof subscriptionDtoSchema>;

export const saasInvoiceDtoSchema = z.object({
  id: z.string(),
  number: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.enum(INVOICE_STATUSES),
  description: z.string().nullable(),
  issuedAt: z.string(),
  dueAt: z.string().nullable(),
  paidAt: z.string().nullable(),
});
export type SaasInvoiceDto = z.infer<typeof saasInvoiceDtoSchema>;

export const billingOverviewSchema = z.object({
  subscription: subscriptionDtoSchema,
  usage: z.object({
    users: z.number(),
    apiKeys: z.number(),
  }),
  invoices: z.array(saasInvoiceDtoSchema),
});
export type BillingOverviewDto = z.infer<typeof billingOverviewSchema>;

export const changePlanSchema = z.object({
  planId: z.string().uuid(),
});

// ── Administração da plataforma ─────────────────────────────────────────────

export const adminTenantDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  suspendedAt: z.string().nullable(),
  usersCount: z.number(),
  planCode: z.string().nullable(),
  planName: z.string().nullable(),
  subscriptionStatus: subscriptionStatusSchema.nullable(),
});
export type AdminTenantDto = z.infer<typeof adminTenantDtoSchema>;

export const adminInvoiceDtoSchema = saasInvoiceDtoSchema.extend({
  tenantName: z.string(),
});
export type AdminInvoiceDto = z.infer<typeof adminInvoiceDtoSchema>;

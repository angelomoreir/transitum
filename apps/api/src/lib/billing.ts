import { eq } from "drizzle-orm";
import type { PlanDto, SaasInvoiceDto, SubscriptionDto } from "@transitum/shared";
import type { DB } from "../db/client.js";
import {
  platformAdmins,
  plans,
  subscriptionInvoices,
  subscriptions,
} from "../db/schema.js";
import { env } from "../env.js";

export const TRIAL_DAYS = 14;

type PlanRow = typeof plans.$inferSelect;
type SubRow = typeof subscriptions.$inferSelect;
type InvoiceRow = typeof subscriptionInvoices.$inferSelect;

const DEFAULT_PLANS = [
  { code: "starter", name: "Starter", priceMonthly: 29, maxUsers: 5, maxApiKeys: 2, sort: 1 },
  { code: "pro", name: "Pro", priceMonthly: 99, maxUsers: 25, maxApiKeys: 10, sort: 2 },
  { code: "enterprise", name: "Enterprise", priceMonthly: 499, maxUsers: 1000, maxApiKeys: 50, sort: 3 },
];

/** Semeia os planos globais no arranque (idempotente por `code`). */
export async function ensurePlans(db: DB): Promise<void> {
  for (const p of DEFAULT_PLANS) {
    await db.insert(plans).values(p).onConflictDoNothing({ target: plans.code });
  }
}

/** Cria subscrição de trial (14 dias, plano Starter) para um novo tenant. */
export async function createTrialSubscription(db: DB, tenantId: string): Promise<void> {
  const [plan] = await db.select().from(plans).where(eq(plans.code, "starter"));
  if (!plan) return;
  const now = new Date();
  const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);
  await db
    .insert(subscriptions)
    .values({
      tenantId,
      planId: plan.id,
      status: "trialing",
      trialEndsAt: trialEnd,
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
    })
    .onConflictDoNothing();
}

export function isPlatformAdminEmail(email: string): boolean {
  const list = env.PLATFORM_ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** Sincroniza `platform_admins` com PLATFORM_ADMIN_EMAILS (a env é a fonte de verdade). */
export async function syncPlatformAdmin(
  db: DB,
  user: { id: string; email: string },
): Promise<boolean> {
  if (isPlatformAdminEmail(user.email)) {
    await db.insert(platformAdmins).values({ userId: user.id }).onConflictDoNothing();
    return true;
  }
  await db.delete(platformAdmins).where(eq(platformAdmins.userId, user.id));
  return false;
}

export async function isUserPlatformAdmin(db: DB, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId));
  return !!row;
}

export function toPlanDto(p: PlanRow): PlanDto {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    priceMonthly: p.priceMonthly,
    currency: p.currency,
    maxUsers: p.maxUsers,
    maxApiKeys: p.maxApiKeys,
    active: p.active,
  };
}

export function toSubscriptionDto(s: SubRow, plan: PlanRow): SubscriptionDto {
  return {
    plan: toPlanDto(plan),
    status: s.status,
    trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
    currentPeriodStart: s.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  };
}

export function toInvoiceDto(i: InvoiceRow): SaasInvoiceDto {
  return {
    id: i.id,
    number: i.number,
    amount: i.amount,
    currency: i.currency,
    status: i.status,
    description: i.description,
    issuedAt: i.issuedAt.toISOString(),
    dueAt: i.dueAt?.toISOString() ?? null,
    paidAt: i.paidAt?.toISOString() ?? null,
  };
}

/** Subscrição + plano de um tenant (lança se não existir). */
export async function getSubscriptionWithPlan(
  db: DB,
  tenantId: string,
): Promise<{ sub: SubRow; plan: PlanRow } | null> {
  const [row] = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.tenantId, tenantId));
  return row ?? null;
}

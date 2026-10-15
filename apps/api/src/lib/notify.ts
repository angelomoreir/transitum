import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import {
  automationRules,
  notifications,
  users,
  webhookDeliveries,
} from "../db/schema.js";

interface NotifyInput {
  tenantId: string;
  /** Gatilho da automatização, ex.: "shipment.delivered" */
  trigger: string;
  title: string;
  body?: string;
  link?: string;
}

async function deliverWebhook(
  db: DB,
  rule: typeof automationRules.$inferSelect,
  payload: Record<string, unknown>,
) {
  const body = JSON.stringify(payload);
  const signature = rule.webhookSecret
    ? `sha256=${createHmac("sha256", rule.webhookSecret).update(body).digest("hex")}`
    : undefined;
  const started = Date.now();
  let statusCode: number | null = null;
  let success = false;
  let error: string | null = null;
  try {
    const res = await fetch(rule.webhookUrl!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-blujay-signature": signature } : {}),
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    statusCode = res.status;
    success = res.ok;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 280) : "falha de rede";
  }
  await db.insert(webhookDeliveries).values({
    tenantId: rule.tenantId,
    ruleId: rule.id,
    url: rule.webhookUrl!,
    trigger: String(payload.trigger),
    statusCode,
    success,
    durationMs: Date.now() - started,
    error,
  });
}

/**
 * Motor de automatizações: para cada regra ativa do gatilho,
 * executa a ação configurada — notificação in-app ou webhook.
 */
export async function notifyTenant(db: DB, input: NotifyInput): Promise<number> {
  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.tenantId, input.tenantId),
        eq(automationRules.trigger, input.trigger),
        eq(automationRules.active, true),
      ),
    );
  if (rules.length === 0) return 0;

  let notified = 0;
  const needsNotify = rules.some((r) => r.action === "notify");
  if (needsNotify) {
    const targets = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, input.tenantId), eq(users.status, "active")));
    if (targets.length > 0) {
      await db.insert(notifications).values(
        targets.map((u) => ({
          tenantId: input.tenantId,
          userId: u.id,
          type: input.trigger,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
        })),
      );
      notified = targets.length;
    }
  }

  const payload = {
    trigger: input.trigger,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    at: new Date().toISOString(),
  };
  for (const rule of rules) {
    if (rule.action === "webhook" && rule.webhookUrl) {
      await deliverWebhook(db, rule, payload);
    }
  }
  return notified;
}

/** Regras por omissão criadas no registo do tenant. */
export const DEFAULT_RULES = [
  { name: "Expedição entregue", trigger: "shipment.delivered" },
  { name: "Receção de compra", trigger: "purchase_order.received" },
  { name: "Rota concluída", trigger: "route.completed" },
] as const;

export async function seedDefaultRules(db: DB, tenantId: string) {
  await db.insert(automationRules).values(
    DEFAULT_RULES.map((r) => ({
      tenantId,
      name: r.name,
      trigger: r.trigger,
      action: "notify",
    })),
  );
}

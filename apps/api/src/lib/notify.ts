import { createHmac } from "node:crypto";
import { and, eq, isNotNull, lt, lte } from "drizzle-orm";
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

// Backoff de retry de webhooks: após tentativas 1 e 2 (máx. 3 no total)
const WEBHOOK_RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000];
const WEBHOOK_MAX_ATTEMPTS = 3;

async function attemptWebhook(
  url: string,
  secret: string | null | undefined,
  body: string,
) {
  const signature = secret
    ? `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
    : undefined;
  const started = Date.now();
  let statusCode: number | null = null;
  let success = false;
  let error: string | null = null;
  try {
    const res = await fetch(url, {
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
  return { statusCode, success, durationMs: Date.now() - started, error };
}

async function deliverWebhook(
  db: DB,
  rule: typeof automationRules.$inferSelect,
  payload: Record<string, unknown>,
) {
  const result = await attemptWebhook(rule.webhookUrl!, rule.webhookSecret, JSON.stringify(payload));
  await db.insert(webhookDeliveries).values({
    tenantId: rule.tenantId,
    ruleId: rule.id,
    url: rule.webhookUrl!,
    trigger: String(payload.trigger),
    payload,
    statusCode: result.statusCode,
    success: result.success,
    durationMs: result.durationMs,
    error: result.error,
    nextRetryAt: result.success
      ? null
      : new Date(Date.now() + WEBHOOK_RETRY_DELAYS_MS[0]),
  });
}

/** Reenvia entregas falhadas cujo `nextRetryAt` já venceu (chamado pelo scheduler). */
export async function retryFailedWebhooks(db: DB): Promise<number> {
  const rows = await db
    .select({ d: webhookDeliveries, rule: automationRules })
    .from(webhookDeliveries)
    .leftJoin(automationRules, eq(webhookDeliveries.ruleId, automationRules.id))
    .where(
      and(
        eq(webhookDeliveries.success, false),
        lt(webhookDeliveries.attempts, WEBHOOK_MAX_ATTEMPTS),
        isNotNull(webhookDeliveries.nextRetryAt),
        lte(webhookDeliveries.nextRetryAt, new Date()),
        isNotNull(webhookDeliveries.payload),
      ),
    );

  let retried = 0;
  for (const { d, rule } of rows) {
    // Sem regra (ou payload) já não é possível reenviar — termina retries
    if (!rule?.webhookUrl || !d.payload) {
      await db
        .update(webhookDeliveries)
        .set({ nextRetryAt: null, attempts: WEBHOOK_MAX_ATTEMPTS })
        .where(eq(webhookDeliveries.id, d.id));
      continue;
    }
    const result = await attemptWebhook(
      rule.webhookUrl,
      rule.webhookSecret,
      JSON.stringify(d.payload),
    );
    const attempts = d.attempts + 1;
    await db
      .update(webhookDeliveries)
      .set({
        attempts,
        statusCode: result.statusCode,
        success: result.success,
        durationMs: result.durationMs,
        error: result.error,
        nextRetryAt:
          result.success || attempts >= WEBHOOK_MAX_ATTEMPTS
            ? null
            : new Date(Date.now() + WEBHOOK_RETRY_DELAYS_MS[attempts - 1]),
      })
      .where(eq(webhookDeliveries.id, d.id));
    retried++;
  }
  return retried;
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

/** Notificação direta a todos os utilizadores ativos de um tenant (sem gatilho/regras). */
export async function notifyUsersDirect(
  db: DB,
  input: Omit<NotifyInput, "trigger"> & { type: string },
): Promise<number> {
  const targets = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, input.tenantId), eq(users.status, "active")));
  if (targets.length === 0) return 0;
  await db.insert(notifications).values(
    targets.map((u) => ({
      tenantId: input.tenantId,
      userId: u.id,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })),
  );
  return targets.length;
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

import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { automationRules, notifications, users } from "../db/schema.js";

interface NotifyInput {
  tenantId: string;
  /** Gatilho da automatização, ex.: "shipment.delivered" */
  trigger: string;
  title: string;
  body?: string;
  link?: string;
}

/**
 * Motor de automatizações: se existir uma regra ativa para o gatilho,
 * cria uma notificação para cada utilizador ativo do tenant.
 */
export async function notifyTenant(db: DB, input: NotifyInput): Promise<number> {
  const rules = await db
    .select({ id: automationRules.id })
    .from(automationRules)
    .where(
      and(
        eq(automationRules.tenantId, input.tenantId),
        eq(automationRules.trigger, input.trigger),
        eq(automationRules.action, "notify"),
        eq(automationRules.active, true),
      ),
    )
    .limit(1);
  if (rules.length === 0) return 0;

  const targets = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, input.tenantId), eq(users.status, "active")));
  if (targets.length === 0) return 0;

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

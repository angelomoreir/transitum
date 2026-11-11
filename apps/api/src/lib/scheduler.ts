import type { FastifyBaseLogger } from "fastify";
import { and, eq, inArray, isNull, lt, lte } from "drizzle-orm";
import type { DB } from "../db/client.js";
import {
  partners,
  shipmentEvents,
  shipments,
  subscriptionInvoices,
  subscriptions,
} from "../db/schema.js";
import { env } from "../env.js";
import { notifyUsersDirect } from "./notify.js";
import { retryFailedWebhooks } from "./notify.js";

/**
 * Tarefas periódicas da plataforma (corre via setInterval no processo da API;
 * em produção pode ser extraído para um worker dedicado):
 *  - trial expirado → subscrição `past_due` + notificação ao tenant
 *  - fatura em aberto vencida → subscrição `past_due` + notificação
 *  - retry de entregas de webhook falhadas (backoff, máx. 3 tentativas)
 */

export async function expireTrials(db: DB): Promise<number> {
  const expired = await db
    .select()
    .from(subscriptions)
    .where(
      and(eq(subscriptions.status, "trialing"), lt(subscriptions.trialEndsAt, new Date())),
    );
  for (const sub of expired) {
    await db
      .update(subscriptions)
      .set({ status: "past_due", updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
    await notifyUsersDirect(db, {
      tenantId: sub.tenantId,
      type: "billing.trial_expired",
      title: "Período experimental terminado",
      body: "O trial de 14 dias terminou. Regularize o pagamento em Faturação para manter a conta ativa.",
      link: "/billing",
    });
  }
  return expired.length;
}

export async function markOverdueSubscriptions(db: DB): Promise<number> {
  const rows = await db
    .select({ sub: subscriptions })
    .from(subscriptionInvoices)
    .innerJoin(subscriptions, eq(subscriptionInvoices.tenantId, subscriptions.tenantId))
    .where(
      and(
        eq(subscriptionInvoices.status, "open"),
        lt(subscriptionInvoices.dueAt, new Date()),
        eq(subscriptions.status, "active"),
      ),
    );
  const seen = new Set<string>();
  for (const { sub } of rows) {
    if (seen.has(sub.id)) continue;
    seen.add(sub.id);
    await db
      .update(subscriptions)
      .set({ status: "past_due", updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));
    await notifyUsersDirect(db, {
      tenantId: sub.tenantId,
      type: "billing.payment_overdue",
      title: "Pagamento em atraso",
      body: "Existe uma fatura vencida por pagar. Regularize em Faturação para evitar a suspensão da conta.",
      link: "/billing",
    });
  }
  return seen.size;
}

/**
 * Expediações com entrega prevista ultrapassada → notificação ao tenant +
 * evento `alert` na timeline (uma vez por expedição via `lateAlertedAt`).
 */
export async function alertLateShipments(db: DB): Promise<number> {
  const late = await db
    .select({
      shipment: shipments,
      customerName: partners.name,
    })
    .from(shipments)
    .innerJoin(partners, eq(shipments.customerId, partners.id))
    .where(
      and(
        inArray(shipments.status, ["planned", "in_transit"]),
        isNull(shipments.lateAlertedAt),
        lt(shipments.plannedDeliveryAt, new Date()),
      ),
    );
  for (const { shipment: s, customerName } of late) {
    await db
      .update(shipments)
      .set({ lateAlertedAt: new Date() })
      .where(eq(shipments.id, s.id));
    await db.insert(shipmentEvents).values({
      tenantId: s.tenantId,
      shipmentId: s.id,
      type: "alert",
      description: `Entrega em atraso — prevista para ${s.plannedDeliveryAt!.toLocaleString("pt-PT")}`,
      occurredAt: new Date(),
    });
    await notifyUsersDirect(db, {
      tenantId: s.tenantId,
      type: "shipment.late",
      title: `Expedição ${s.number} em atraso`,
      body: `A entrega ao cliente ${customerName} estava prevista para ${s.plannedDeliveryAt!.toLocaleString("pt-PT")} e ainda não foi concluída.`,
      link: `/shipments/${s.id}`,
    });
  }
  return late.length;
}

export async function runSchedulerOnce(db: DB): Promise<void> {
  await expireTrials(db);
  await markOverdueSubscriptions(db);
  await alertLateShipments(db);
  await retryFailedWebhooks(db);
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(db: DB, log: FastifyBaseLogger): void {
  if (env.NODE_ENV === "test" || timer) return;
  const tick = () =>
    runSchedulerOnce(db).catch((err) => log.error({ err }, "scheduler tick falhou"));
  // primeira passagem 30s após arranque, depois a cada intervalo
  setTimeout(tick, 30_000).unref();
  timer = setInterval(tick, env.SCHEDULER_INTERVAL_MS);
  timer.unref();
}

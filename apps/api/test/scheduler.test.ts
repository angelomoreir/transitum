import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  automationRules,
  notifications,
  subscriptions,
  subscriptionInvoices,
  webhookDeliveries,
} from "../src/db/schema.js";
import {
  expireTrials,
  markOverdueSubscriptions,
} from "../src/lib/scheduler.js";
import { retryFailedWebhooks } from "../src/lib/notify.js";
import { createTestApp, registerTenant } from "./helpers.js";

let app: FastifyInstance;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function makeTenant() {
  const { res } = await registerTenant(app);
  return { token: res.json().accessToken as string, tenant: res.json().tenant };
}

beforeAll(async () => {
  ({ app } = await createTestApp());
});
afterAll(async () => {
  await app.close();
});

describe("scheduler: subscrições", () => {
  it("trial expirado passa a past_due e notifica o tenant", async () => {
    const { token, tenant } = await makeTenant();
    await app.db
      .update(subscriptions)
      .set({ trialEndsAt: new Date(Date.now() - 86_400_000) })
      .where(eq(subscriptions.tenantId, tenant.id));

    const n = await expireTrials(app.db);
    expect(n).toBe(1);

    const [sub] = await app.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenant.id));
    expect(sub.status).toBe("past_due");

    const notes = await app.db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenant.id));
    expect(notes.some((x) => x.type === "billing.trial_expired")).toBe(true);
    // token continua válido para leitura
    const res = await app.inject({ method: "GET", url: "/api/billing", headers: auth(token) });
    expect(res.statusCode).toBe(200);
  });

  it("fatura vencida em conta ativa passa a past_due", async () => {
    const { token, tenant } = await makeTenant();
    // pagar fatura → ativa
    const inv = await app.inject({
      method: "POST",
      url: "/api/billing/invoices",
      headers: auth(token),
    });
    await app.inject({
      method: "POST",
      url: `/api/billing/invoices/${inv.json().invoice.id}/pay`,
      headers: auth(token),
    });
    // nova fatura já vencida
    await app.db.insert(subscriptionInvoices).values({
      tenantId: tenant.id,
      number: "INV-99999",
      amount: 29,
      status: "open",
      dueAt: new Date(Date.now() - 86_400_000),
    });

    const n = await markOverdueSubscriptions(app.db);
    expect(n).toBe(1);
    const [sub] = await app.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenant.id));
    expect(sub.status).toBe("past_due");
  });
});

describe("expiração de chaves de API", () => {
  it("chave expirada deixa de autenticar na v1", async () => {
    const { token } = await makeTenant();
    const expired = await app.inject({
      method: "POST",
      url: "/api/integrations/keys",
      headers: auth(token),
      payload: {
        name: "Chave antiga",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    expect(expired.statusCode).toBe(201);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/orders",
      headers: { "x-api-key": expired.json().secret },
    });
    expect(res.statusCode).toBe(401);
  });

  it("chave com expiração futura autentica normalmente", async () => {
    const { token } = await makeTenant();
    const res = await app.inject({
      method: "POST",
      url: "/api/integrations/keys",
      headers: auth(token),
      payload: {
        name: "Chave futura",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    const ok = await app.inject({
      method: "GET",
      url: "/api/v1/orders",
      headers: { "x-api-key": res.json().secret },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe("retry de webhooks", () => {
  let server: Server;
  let received: string[] = [];

  beforeAll(async () => {
    received = [];
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push(body);
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });
  afterAll(() => server.close());

  it("entrega falhada é reenviada pelo scheduler", async () => {
    const { token, tenant } = await makeTenant();
    const port = (server.address() as AddressInfo).port;
    const rule = await app.inject({
      method: "POST",
      url: "/api/automations",
      headers: auth(token),
      payload: {
        name: "Hook retry",
        trigger: "order.confirmed",
        action: "webhook",
        webhookUrl: `http://127.0.0.1:${port}/retry`,
      },
    });
    expect(rule.statusCode).toBe(201);
    const ruleId = rule.json().rule.id;

    // Simular uma entrega falhada pendente de retry
    const payload = { trigger: "order.confirmed", title: "ENC-00001", at: new Date().toISOString() };
    const [d] = await app.db
      .insert(webhookDeliveries)
      .values({
        tenantId: tenant.id,
        ruleId,
        url: `http://127.0.0.1:${port}/retry`,
        trigger: "order.confirmed",
        payload,
        success: false,
        attempts: 1,
        nextRetryAt: new Date(Date.now() - 1000),
        error: "falha de rede",
      })
      .returning();

    const retried = await retryFailedWebhooks(app.db);
    expect(retried).toBe(1);
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]).trigger).toBe("order.confirmed");

    const [row] = await app.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, d.id));
    expect(row.success).toBe(true);
    expect(row.attempts).toBe(2);
    expect(row.nextRetryAt).toBeNull();

    // verifica que a regra existe mesmo (sanity check)
    const [r] = await app.db
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.id, ruleId), eq(automationRules.tenantId, tenant.id)));
    expect(r.webhookUrl).toContain("/retry");
  });

  it("entrega falhada atinge o máximo de tentativas", async () => {
    const { tenant } = await makeTenant();
    const [d] = await app.db
      .insert(webhookDeliveries)
      .values({
        tenantId: tenant.id,
        url: "http://127.0.0.1:1/unreachable",
        trigger: "order.confirmed",
        payload: { trigger: "order.confirmed" },
        success: false,
        attempts: 2,
        nextRetryAt: new Date(Date.now() - 1000),
      })
      .returning();
    await retryFailedWebhooks(app.db);
    const [row] = await app.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, d.id));
    expect(row.attempts).toBe(3);
    expect(row.success).toBe(false);
    expect(row.nextRetryAt).toBeNull();
  });
});

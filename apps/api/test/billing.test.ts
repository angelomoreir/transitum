import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { platformAdmins, plans, tenants } from "../src/db/schema.js";
import { createTestApp, registerTenant } from "./helpers.js";

let app: FastifyInstance;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function makeTenant() {
  const { res } = await registerTenant(app);
  expect(res.statusCode).toBe(200);
  const body = res.json();
  return { token: body.accessToken as string, user: body.user, tenant: body.tenant };
}

beforeEach(async () => {
  ({ app } = await createTestApp());
});
afterEach(async () => {
  await app.close();
});

describe("Subscrições e faturação", () => {
  it("registo cria subscrição trial de 14 dias no plano Starter", async () => {
    const { token } = await makeTenant();
    const res = await app.inject({
      method: "GET",
      url: "/api/billing",
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const { subscription, usage, invoices } = res.json();
    expect(subscription.status).toBe("trialing");
    expect(subscription.plan.code).toBe("starter");
    expect(subscription.trialEndsAt).toBeTruthy();
    expect(subscription.currentPeriodEnd).toBeTruthy();
    const trialMs =
      new Date(subscription.trialEndsAt).getTime() -
      new Date(subscription.currentPeriodStart).getTime();
    expect(Math.round(trialMs / 86_400_000)).toBe(14);
    expect(usage.users).toBe(1);
    expect(invoices).toEqual([]);
  });

  it("lista os 3 planos globais", async () => {
    const { token } = await makeTenant();
    const res = await app.inject({
      method: "GET",
      url: "/api/billing/plans",
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    const codes = res.json().items.map((p: { code: string }) => p.code);
    expect(codes).toEqual(["starter", "pro", "enterprise"]);
    const starter = res.json().items[0];
    expect(starter.maxUsers).toBe(5);
    expect(starter.maxApiKeys).toBe(2);
  });

  it("emite fatura INV-xxxxx, paga e ativa a subscrição", async () => {
    const { token } = await makeTenant();
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/invoices",
      headers: auth(token),
    });
    expect(res.statusCode).toBe(201);
    const { invoice } = res.json();
    expect(invoice.number).toMatch(/^INV-\d{5}$/);
    expect(invoice.status).toBe("open");
    expect(invoice.amount).toBe(29);

    const pay = await app.inject({
      method: "POST",
      url: `/api/billing/invoices/${invoice.id}/pay`,
      headers: auth(token),
    });
    expect(pay.statusCode).toBe(200);
    expect(pay.json().invoice.status).toBe("paid");
    expect(pay.json().invoice.paidAt).toBeTruthy();

    const overview = await app.inject({
      method: "GET",
      url: "/api/billing",
      headers: auth(token),
    });
    expect(overview.json().subscription.status).toBe("active");
  });

  it("anula fatura em aberto e rejeita anulação de fatura paga", async () => {
    const { token } = await makeTenant();
    const mk = () =>
      app.inject({ method: "POST", url: "/api/billing/invoices", headers: auth(token) });
    const inv1 = (await mk()).json().invoice;
    const inv2 = (await mk()).json().invoice;
    expect(inv2.number).not.toBe(inv1.number);

    const voidRes = await app.inject({
      method: "POST",
      url: `/api/billing/invoices/${inv1.id}/void`,
      headers: auth(token),
    });
    expect(voidRes.statusCode).toBe(200);
    expect(voidRes.json().invoice.status).toBe("void");

    await app.inject({
      method: "POST",
      url: `/api/billing/invoices/${inv2.id}/pay`,
      headers: auth(token),
    });
    const voidPaid = await app.inject({
      method: "POST",
      url: `/api/billing/invoices/${inv2.id}/void`,
      headers: auth(token),
    });
    expect(voidPaid.statusCode).toBe(400);
  });

  it("muda o plano para Pro", async () => {
    const { token } = await makeTenant();
    const planList = await app.inject({
      method: "GET",
      url: "/api/billing/plans",
      headers: auth(token),
    });
    const pro = planList.json().items.find((p: { code: string }) => p.code === "pro");
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/plan",
      headers: auth(token),
      payload: { planId: pro.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().subscription.plan.code).toBe("pro");
    expect(res.json().subscription.plan.maxUsers).toBe(25);
  });

  it("bloqueia convites quando o limite de utilizadores do plano é atingido", async () => {
    const { token } = await makeTenant();
    // Starter permite 5 utilizadores; o admin já conta como 1
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/users/invite",
        headers: auth(token),
        payload: { name: "User T", email: `u${i}-${crypto.randomUUID().slice(0, 6)}@t.pt`, role: "viewer" },
      });
      expect(res.statusCode).toBe(201);
    }
    const over = await app.inject({
      method: "POST",
      url: "/api/users/invite",
      headers: auth(token),
      payload: { name: "User X", email: `x-${crypto.randomUUID().slice(0, 6)}@t.pt`, role: "viewer" },
    });
    expect(over.statusCode).toBe(403);
  });

  it("tenant suspenso mantém leitura mas não escrita", async () => {
    const { token, tenant } = await makeTenant();
    await app.db
      .update(tenants)
      .set({ suspendedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    const read = await app.inject({
      method: "GET",
      url: "/api/partners",
      headers: auth(token),
    });
    expect(read.statusCode).toBe(200);

    const write = await app.inject({
      method: "POST",
      url: "/api/partners",
      headers: auth(token),
      payload: { types: ["customer"], name: "Cliente Bloqueado" },
    });
    expect(write.statusCode).toBe(403);
  });

  it("faturas são isoladas por tenant", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await app.inject({ method: "POST", url: "/api/billing/invoices", headers: auth(a.token) });
    const resA = await app.inject({ method: "GET", url: "/api/billing", headers: auth(a.token) });
    const resB = await app.inject({ method: "GET", url: "/api/billing", headers: auth(b.token) });
    expect(resA.json().invoices).toHaveLength(1);
    expect(resB.json().invoices).toHaveLength(0);
  });
});

describe("Administração da plataforma", () => {
  it("rejeita /api/admin para utilizadores normais", async () => {
    const { token } = await makeTenant();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/tenants",
      headers: auth(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it("platform admin lista tenants, muda plano, suspende e reativa", async () => {
    const admin = await makeTenant();
    const target = await makeTenant();

    // Promover o primeiro utilizador a platform admin (equivale a PLATFORM_ADMIN_EMAILS)
    await app.db.insert(platformAdmins).values({ userId: admin.user.id });
    expect(admin.user.isPlatformAdmin).toBe(false); // DTO no registo; /me reflete depois

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/tenants",
      headers: auth(admin.token),
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().items;
    expect(items).toHaveLength(2);
    const targetRow = items.find((t: { id: string }) => t.id === target.tenant.id);
    expect(targetRow.subscriptionStatus).toBe("trialing");
    expect(targetRow.usersCount).toBe(1);

    const [proPlan] = await app.db.select().from(plans).where(eq(plans.code, "pro"));
    const planRes = await app.inject({
      method: "POST",
      url: `/api/admin/tenants/${target.tenant.id}/plan`,
      headers: auth(admin.token),
      payload: { planId: proPlan.id },
    });
    expect(planRes.statusCode).toBe(200);

    const susp = await app.inject({
      method: "POST",
      url: `/api/admin/tenants/${target.tenant.id}/suspend`,
      headers: auth(admin.token),
    });
    expect(susp.statusCode).toBe(200);

    // O tenant suspenso não pode escrever
    const write = await app.inject({
      method: "POST",
      url: "/api/partners",
      headers: auth(target.token),
      payload: { types: ["customer"], name: "Cliente X" },
    });
    expect(write.statusCode).toBe(403);

    const act = await app.inject({
      method: "POST",
      url: `/api/admin/tenants/${target.tenant.id}/activate`,
      headers: auth(admin.token),
    });
    expect(act.statusCode).toBe(200);
    const write2 = await app.inject({
      method: "POST",
      url: "/api/partners",
      headers: auth(target.token),
      payload: { types: ["customer"], name: "Cliente X" },
    });
    expect(write2.statusCode).toBe(201);
  });

  it("platform admin vê faturas de todos os tenants", async () => {
    const admin = await makeTenant();
    const tenant2 = await makeTenant();
    await app.db.insert(platformAdmins).values({ userId: admin.user.id });
    await app.inject({ method: "POST", url: "/api/billing/invoices", headers: auth(tenant2.token) });

    const res = await app.inject({
      method: "GET",
      url: "/api/admin/invoices",
      headers: auth(admin.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].tenantName).toBe(tenant2.tenant.name);
  });
});

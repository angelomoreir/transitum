import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registerTenant, type TestApp } from "./helpers.js";

let t: TestApp;
let tokenA: string;
let tenantAUsers: string;

beforeAll(async () => {
  t = await createTestApp();
  const a = await registerTenant(t.app, { companyName: "Empresa A" });
  tokenA = a.res.json().accessToken;
  const b = await registerTenant(t.app, { companyName: "Empresa B" });
  tenantAUsers = b.res.json().user.id; // id do admin da empresa B
});
afterAll(async () => {
  await t.app.close();
});

describe("isolamento multi-tenant", () => {
  it("listagem de utilizadores só mostra o próprio tenant", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    expect(items).toHaveLength(1);
    expect(items[0].id).not.toBe(tenantAUsers);
  });

  it("GET por id de outro tenant → 404", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: `/api/users/${tenantAUsers}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("pesquisa não revela utilizadores de outros tenants", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/api/search?q=admin",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(200);
    for (const u of res.json().users) {
      expect(u.id).not.toBe(tenantAUsers);
    }
  });

  it("stats só contam o próprio tenant", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/api/stats",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().activeUsers).toBe(1);
  });
});

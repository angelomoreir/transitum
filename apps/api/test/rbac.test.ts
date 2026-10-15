import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, extractToken, registerTenant, type TestApp } from "./helpers.js";

let t: TestApp;
let adminToken: string;

async function inviteAndAccept(
  email: string,
  role: string,
): Promise<string> {
  const invite = await t.app.inject({
    method: "POST",
    url: "/api/users/invite",
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { name: `User ${role}`, email, role },
  });
  expect(invite.statusCode).toBe(201);
  const token = extractToken(invite.json().inviteUrl);
  const accept = await t.app.inject({
    method: "POST",
    url: "/api/auth/accept-invite",
    payload: { token, password: "Password123" },
  });
  expect(accept.statusCode).toBe(200);
  return accept.json().accessToken;
}

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  adminToken = res.json().accessToken;
});
afterAll(async () => {
  await t.app.close();
});

describe("RBAC", () => {
  it("admin convida utilizador com sucesso", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/users/invite",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Novo Operador", email: "op1@teste.pt", role: "operator" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.status).toBe("invited");
    expect(res.json().inviteUrl).toContain("/accept-invite?token=");
  });

  it("viewer não pode convidar nem editar, mas pode ler", async () => {
    const viewer = await inviteAndAccept("viewer1@teste.pt", "viewer");

    const inviteRes = await t.app.inject({
      method: "POST",
      url: "/api/users/invite",
      headers: { authorization: `Bearer ${viewer}` },
      payload: { name: "User X", email: "x@teste.pt", role: "operator" },
    });
    expect(inviteRes.statusCode).toBe(403);

    const list = await t.app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${viewer}` },
    });
    expect(list.statusCode).toBe(200);
  });

  it("manager pode convidar mas não alterar funções", async () => {
    const manager = await inviteAndAccept("mgr@teste.pt", "manager");

    const invite = await t.app.inject({
      method: "POST",
      url: "/api/users/invite",
      headers: { authorization: `Bearer ${manager}` },
      payload: { name: "Op", email: "op2@teste.pt", role: "operator" },
    });
    expect(invite.statusCode).toBe(201);

    const { items } = (
      await t.app.inject({
        method: "GET",
        url: "/api/users",
        headers: { authorization: `Bearer ${manager}` },
      })
    ).json();
    const admin = items.find((u: { role: string }) => u.role === "admin")!;

    const patch = await t.app.inject({
      method: "PATCH",
      url: `/api/users/${admin.id}`,
      headers: { authorization: `Bearer ${manager}` },
      payload: { role: "viewer" },
    });
    expect(patch.statusCode).toBe(403);
  });

  it("não é possível suspender o último admin", async () => {
    const { items } = (
      await t.app.inject({
        method: "GET",
        url: "/api/users?role=admin",
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json();
    const soleAdmin = items.find((u: { email: string }) => u.email.includes("admin-"));
    const res = await t.app.inject({
      method: "DELETE",
      url: `/api/users/${soleAdmin.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    // suspender a própria conta → 400
    expect(res.statusCode).toBe(400);
  });
});

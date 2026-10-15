import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, extractToken, registerTenant, type TestApp } from "./helpers.js";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.app.close();
});

describe("registo de empresa", () => {
  it("cria tenant + admin e devolve tokens", async () => {
    const { res, body } = await registerTenant(t.app, { companyName: "Logística Norte" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.accessToken).toBeTruthy();
    expect(json.user.role).toBe("admin");
    expect(json.user.status).toBe("active");
    expect(json.tenant.name).toBe("Logística Norte");
    expect(res.cookies.find((c) => c.name === "blujay_rt")).toBeTruthy();
    expect(body.email).toBe(json.user.email);
  });

  it("rejeita email duplicado", async () => {
    const first = await registerTenant(t.app);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        companyName: "Outra Empresa",
        name: "Outro Admin",
        email: first.body.email,
        password: "Password123",
      },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("login", () => {
  it("autentica com credenciais corretas", async () => {
    const { body } = await registerTenant(t.app);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: body.email, password: body.password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTruthy();
  });

  it("rejeita password errada", async () => {
    const { body } = await registerTenant(t.app);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: body.email, password: "Errada123" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("me", () => {
  it("devolve utilizador autenticado", async () => {
    const { res } = await registerTenant(t.app);
    const { accessToken } = res.json();
    const me = await t.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBeTruthy();
  });

  it("rejeita sem token", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
  });
});

describe("refresh token", () => {
  it("rota o token e revoga reutilização", async () => {
    const { res } = await registerTenant(t.app);
    const cookie = res.cookies.find((c) => c.name === "blujay_rt")!;

    const refresh1 = await t.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { blujay_rt: cookie.value },
    });
    expect(refresh1.statusCode).toBe(200);
    expect(refresh1.json().accessToken).toBeTruthy();

    // Reutilizar o token antigo (já revogado) → 401
    const reuse = await t.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      cookies: { blujay_rt: cookie.value },
    });
    expect(reuse.statusCode).toBe(401);
  });
});

describe("recuperação de palavra-passe", () => {
  it("fluxo completo: forgot → reset → login", async () => {
    const { body } = await registerTenant(t.app);

    const forgot = await t.app.inject({
      method: "POST",
      url: "/api/auth/forgot-password",
      payload: { email: body.email },
    });
    expect(forgot.statusCode).toBe(200);

    const mail = t.mailer.sent.find((m) => m.subject.includes("Recuperação"));
    expect(mail).toBeTruthy();
    const token = extractToken(mail!.text);

    const reset = await t.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token, password: "NovaPassword456" },
    });
    expect(reset.statusCode).toBe(200);

    const login = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: body.email, password: "NovaPassword456" },
    });
    expect(login.statusCode).toBe(200);

    // Token não pode ser reutilizado
    const reuse = await t.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token, password: "OutraPass789" },
    });
    expect(reuse.statusCode).toBe(400);
  });
});

describe("health", () => {
  it("health e ready respondem", async () => {
    const h = await t.app.inject({ method: "GET", url: "/api/health" });
    expect(h.statusCode).toBe(200);
    const r = await t.app.inject({ method: "GET", url: "/api/ready" });
    expect(r.statusCode).toBe(200);
    expect(r.json().driver).toBe("pglite");
  });
});

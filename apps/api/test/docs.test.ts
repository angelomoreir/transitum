import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registerTenant, type TestApp } from "./helpers.js";

let t: TestApp;
let token: string;
let partnerId: string;
let routeId: string;
let docId: string;

const authed = (url: string, opts: { method?: string; payload?: unknown } = {}) =>
  t.app.inject({
    method: opts.method ?? "GET",
    url,
    headers: { authorization: `Bearer ${token}` },
    payload: opts.payload as Record<string, unknown> | undefined,
  });

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  token = res.json().accessToken;

  const p = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["customer"], name: "Cliente T5" },
  });
  partnerId = p.json().partner.id;
});

afterAll(async () => {
  await t.app.close();
});

describe("documentos", () => {
  it("faz upload de documento ligado a parceiro", async () => {
    const res = await authed("/api/documents", {
      method: "POST",
      payload: {
        entityType: "partner",
        entityId: partnerId,
        fileName: "contrato.pdf",
        mimeType: "application/pdf",
        contentBase64: Buffer.from("conteudo do contrato").toString("base64"),
      },
    });
    expect(res.statusCode).toBe(201);
    const { document } = res.json();
    expect(document.fileName).toBe("contrato.pdf");
    expect(document.sizeBytes).toBe(20);
    expect(document.uploadedByName).toBe("Admin Teste");
    docId = document.id;
  });

  it("rejeita entidade inexistente", async () => {
    const res = await authed("/api/documents", {
      method: "POST",
      payload: {
        entityType: "partner",
        entityId: crypto.randomUUID(),
        fileName: "x.txt",
        contentBase64: Buffer.from("x").toString("base64"),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejeita ficheiro acima de 5 MB", async () => {
    const res = await authed("/api/documents", {
      method: "POST",
      payload: {
        entityType: "partner",
        entityId: partnerId,
        fileName: "grande.bin",
        contentBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lista documentos por entidade", async () => {
    const res = await authed(`/api/documents?entityType=partner&entityId=${partnerId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().items.some((d: { id: string }) => d.id === docId)).toBe(true);
  });

  it("faz download com o conteúdo original", async () => {
    const res = await authed(`/api/documents/${docId}/download`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body).toBe("conteudo do contrato");
  });
});

describe("automatizações", () => {
  let ruleId: string;

  it("tenant novo tem 3 regras por omissão", async () => {
    const res = await authed("/api/automations");
    expect(res.statusCode).toBe(200);
    const { items } = res.json();
    expect(items).toHaveLength(3);
    expect(items.map((r: { trigger: string }) => r.trigger)).toEqual(
      expect.arrayContaining([
        "shipment.delivered",
        "purchase_order.received",
        "route.completed",
      ]),
    );
  });

  it("cria regra personalizada", async () => {
    const res = await authed("/api/automations", {
      method: "POST",
      payload: { name: "Encomenda confirmada", trigger: "order.confirmed" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().rule.active).toBe(true);
    ruleId = res.json().rule.id;
  });

  it("desativa regra", async () => {
    const res = await authed(`/api/automations/${ruleId}`, {
      method: "PATCH",
      payload: { active: false },
    });
    expect(res.json().rule.active).toBe(false);
  });
});

describe("notificações e gatilhos", () => {
  it("completar rota gera notificação (regra por omissão)", async () => {
    const r = await authed("/api/routes", {
      method: "POST",
      payload: { name: "Rota Norte", stops: [] },
    });
    expect(r.statusCode).toBe(201);
    routeId = r.json().route.id;

    await authed(`/api/routes/${routeId}/status`, {
      method: "POST",
      payload: { status: "dispatched" },
    });
    await authed(`/api/routes/${routeId}/status`, {
      method: "POST",
      payload: { status: "completed" },
    });

    const res = await authed("/api/notifications");
    const { items, unread } = res.json();
    expect(unread).toBeGreaterThan(0);
    const n = items.find((i: { type: string }) => i.type === "route.completed");
    expect(n).toBeTruthy();
    expect(n.title).toContain("ROT-");
    expect(n.link).toBe(`/routes/${routeId}`);
  });

  it("regra inativa não notifica", async () => {
    // A regra order.confirmed foi criada mas desativada acima
    const o = await authed("/api/orders", {
      method: "POST",
      payload: {
        customerId: partnerId,
        lines: [{ description: "Paletes", quantity: 2 }],
      },
    });
    const orderId = o.json().order.id;
    await authed(`/api/orders/${orderId}`, {
      method: "PATCH",
      payload: { status: "confirmed" },
    });

    const res = await authed("/api/notifications?unread=true");
    const found = res.json().items.find((i: { type: string }) => i.type === "order.confirmed");
    expect(found).toBeUndefined();
  });

  it("marcar como lida e marcar todas", async () => {
    const res = await authed("/api/notifications");
    const first = res.json().items[0];
    expect(first.readAt).toBeNull();

    const r1 = await authed(`/api/notifications/${first.id}/read`, { method: "POST" });
    expect(r1.statusCode).toBe(200);

    const r2 = await authed("/api/notifications/read-all", { method: "POST" });
    expect(r2.statusCode).toBe(200);

    const after = await authed("/api/notifications");
    expect(after.json().unread).toBe(0);
  });
});

describe("isolamento por tenant", () => {
  let otherToken: string;

  beforeAll(async () => {
    const { res } = await registerTenant(t.app);
    otherToken = res.json().accessToken;
  });

  const other = (url: string, opts: { method?: string; payload?: unknown } = {}) =>
    t.app.inject({
      method: opts.method ?? "GET",
      url,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: opts.payload as Record<string, unknown> | undefined,
    });

  it("outro tenant não vê os documentos", async () => {
    const res = await other("/api/documents");
    expect(res.json().total).toBe(0);
  });

  it("outro tenant não faz download do documento", async () => {
    const res = await other(`/api/documents/${docId}/download`);
    expect(res.statusCode).toBe(404);
  });

  it("outro tenant não vê notificações alheias", async () => {
    const res = await other("/api/notifications");
    expect(res.json().total).toBe(0);
  });

  it("outro tenant não marca notificação alheia", async () => {
    const res = await authed("/api/notifications");
    const someId = res.json().items[0].id;
    const r = await other(`/api/notifications/${someId}/read`, { method: "POST" });
    expect(r.statusCode).toBe(404);
  });
});

describe("remoção de documento", () => {
  it("remove documento e ficheiro", async () => {
    const res = await authed(`/api/documents/${docId}`, { method: "DELETE" });
    expect(res.statusCode).toBe(200);
    const check = await authed(`/api/documents/${docId}/download`);
    expect(check.statusCode).toBe(404);
  });
});

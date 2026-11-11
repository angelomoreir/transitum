import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registerTenant, type TestApp } from "./helpers.js";

let t: TestApp;
let token: string;
let customerId: string;
let shipmentId: string;
let customsItemId: string;
let apiKey: string;

const authed = (url: string, opts: { method?: string; payload?: unknown } = {}) =>
  t.app.inject({
    method: opts.method ?? "GET",
    url,
    headers: { authorization: `Bearer ${token}` },
    payload: opts.payload as Record<string, unknown> | undefined,
  });

const v1 = (url: string, opts: { method?: string; payload?: unknown; key?: string } = {}) =>
  t.app.inject({
    method: opts.method ?? "GET",
    url: `/api/v1${url}`,
    headers: opts.key === null ? {} : { "x-api-key": opts.key ?? apiKey },
    payload: opts.payload as Record<string, unknown> | undefined,
  });

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  token = res.json().accessToken;

  const p = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["customer"], name: "Cliente T6" },
  });
  customerId = p.json().partner.id;

  const s = await authed("/api/shipments", {
    method: "POST",
    payload: {
      customerId,
      incoterm: "DAP",
      pickupAddress: { line1: "Rua A", city: "Porto", postalCode: "4000", country: "PT" },
      deliveryAddress: { line1: "Rue B", city: "Lyon", postalCode: "69000", country: "FR" },
    },
  });
  shipmentId = s.json().shipment.id;
});

afterAll(async () => {
  await t.app.close();
});

describe("alfândega / comércio internacional", () => {
  it("expedição criada com incoterm", async () => {
    const res = await authed(`/api/shipments/${shipmentId}`);
    const s = res.json().shipment;
    expect(s.incoterm).toBe("DAP");
    expect(s.customsStatus).toBe("none");
  });

  it("adiciona item aduaneiro", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/customs-items`, {
      method: "POST",
      payload: {
        description: "Componentes eletrónicos",
        hsCode: "854239",
        originCountry: "PT",
        quantity: 100,
        weightKg: 12.5,
        value: 4500,
        currency: "EUR",
      },
    });
    expect(res.statusCode).toBe(201);
    customsItemId = res.json().item.id;

    const detail = await authed(`/api/shipments/${shipmentId}`);
    expect(detail.json().shipment.customsItems).toHaveLength(1);
  });

  it("transições aduaneiras: none→prepared→submitted→cleared", async () => {
    for (const status of ["prepared", "submitted", "cleared"]) {
      const res = await authed(`/api/shipments/${shipmentId}/customs`, {
        method: "PATCH",
        payload: { customsStatus: status },
      });
      expect(res.statusCode).toBe(200);
    }
    const detail = await authed(`/api/shipments/${shipmentId}`);
    const s = detail.json().shipment;
    expect(s.customsStatus).toBe("cleared");
    // eventos aduaneiros na timeline
    expect(s.events.filter((e: { type: string }) => e.type === "customs")).toHaveLength(3);
  });

  it("rejeita transição inválida (cleared→held)", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/customs`, {
      method: "PATCH",
      payload: { customsStatus: "held" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("exporta fatura comercial em CSV", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/commercial-invoice.csv`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("FATURA COMERCIAL");
    expect(res.body).toContain("Componentes eletrónicos");
    expect(res.body).toContain("854239");
    expect(res.body).toContain("DAP");
  });
});

describe("chaves de API e API pública v1", () => {
  it("cria chave e devolve segredo uma vez", async () => {
    const res = await authed("/api/integrations/keys", {
      method: "POST",
      payload: { name: "ERP externo" },
    });
    expect(res.statusCode).toBe(201);
    const { key, secret } = res.json();
    expect(key.prefix).toMatch(/^bjk_[0-9a-f]{8}$/);
    expect(secret).toContain(key.prefix);
    apiKey = secret;

    const list = await authed("/api/integrations/keys");
    const listed = list.json().items.find((k: { id: string }) => k.id === key.id);
    expect(listed.name).toBe("ERP externo");
    // o segredo não volta a aparecer
    expect(JSON.stringify(list.json())).not.toContain(secret);
  });

  it("v1 sem chave devolve 401", async () => {
    const res = await v1("/orders", { key: null as unknown as string });
    expect(res.statusCode).toBe(401);
  });

  it("v1 com chave inválida devolve 401", async () => {
    const res = await v1("/orders", { key: "bjk_aaaaaaaa_bad" });
    expect(res.statusCode).toBe(401);
  });

  it("v1 cria e lista encomendas no tenant da chave", async () => {
    const created = await v1("/orders", {
      method: "POST",
      payload: {
        customerId,
        lines: [{ description: "Via API", quantity: 3 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const orderId = created.json().order.id;

    const list = await v1("/orders");
    expect(list.json().total).toBe(1);

    const detail = await v1(`/orders/${orderId}`);
    expect(detail.json().order.lines[0].description).toBe("Via API");
  });

  it("v1 lista expedições do tenant", async () => {
    const res = await v1("/shipments");
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].incoterm).toBe("DAP");
    expect(res.json().items[0].customsStatus).toBe("cleared");
  });

  it("chave revogada deixa de autenticar", async () => {
    const list = await authed("/api/integrations/keys");
    const keyRow = list.json().items[0];
    await authed(`/api/integrations/keys/${keyRow.id}`, { method: "DELETE" });
    const res = await v1("/orders");
    expect(res.statusCode).toBe(401);
  });
});

describe("webhooks", () => {
  let server: Server;
  let received: { body: string; signature?: string }[] = [];

  beforeAll(async () => {
    received = [];
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({
          body,
          signature: req.headers["x-transitum-signature"] as string | undefined,
        });
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });

  afterAll(() => server.close());

  it("regra webhook recebe POST assinado ao concluir rota", async () => {
    const port = (server.address() as AddressInfo).port;
    const rule = await authed("/api/automations", {
      method: "POST",
      payload: {
        name: "Hook rota",
        trigger: "route.completed",
        action: "webhook",
        webhookUrl: `http://127.0.0.1:${port}/hook`,
      },
    });
    expect(rule.statusCode).toBe(201);

    const r = await authed("/api/routes", {
      method: "POST",
      payload: { name: "Rota Hook", stops: [] },
    });
    const routeId = r.json().route.id;
    await authed(`/api/routes/${routeId}/status`, {
      method: "POST",
      payload: { status: "dispatched" },
    });
    await authed(`/api/routes/${routeId}/status`, {
      method: "POST",
      payload: { status: "completed" },
    });

    expect(received).toHaveLength(1);
    const payload = JSON.parse(received[0].body);
    expect(payload.trigger).toBe("route.completed");
    expect(payload.title).toContain("ROT-");
    expect(received[0].signature).toMatch(/^sha256=[0-9a-f]{64}$/);

    // entrega registada
    const deliveries = await authed("/api/integrations/webhook-deliveries");
    const d = deliveries.json().items[0];
    expect(d.success).toBe(true);
    expect(d.statusCode).toBe(200);
    expect(d.url).toContain("/hook");
  });
});

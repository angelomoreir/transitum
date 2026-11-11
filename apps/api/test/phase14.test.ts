import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registerTenant, type TestApp } from "./helpers.js";

/**
 * Fase 14 — canais webhook Shopify/WooCommerce com HMAC, lotes com
 * validade e consumo FEFO, wave picking agregado e criação de
 * encomendas no portal do cliente.
 */

let t: TestApp;
let token: string;
let customerId: string;
let warehouseId: string;
let itemId: string;

const authed = (url: string, opts: { method?: string; payload?: unknown; bearer?: string } = {}) =>
  t.app.inject({
    method: opts.method ?? "GET",
    url,
    headers: { authorization: `Bearer ${opts.bearer ?? token}` },
    payload: opts.payload as Record<string, unknown> | undefined,
  });

const hook = (
  token_: string,
  secret: string,
  payload: Record<string, unknown>,
  header: "x-shopify-hmac-sha256" | "x-wc-webhook-signature" | "x-transitum-signature",
  digest: "base64" | "hex" = "base64",
) => {
  const raw = JSON.stringify(payload);
  const sig = createHmac("sha256", secret).update(raw, "utf8").digest(digest);
  return t.app.inject({
    method: "POST",
    url: `/api/inbound/${token_}`,
    headers: { "content-type": "application/json", [header]: sig },
    payload: raw,
  });
};

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  token = res.json().accessToken;

  const c = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["customer"], name: "Cliente Fase 14" },
  });
  customerId = c.json().partner.id;

  const wh = await authed("/api/warehouses", {
    method: "POST",
    payload: { name: "Armazém F14" },
  });
  warehouseId = wh.json().warehouse.id;

  const i = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F14-001", name: "Artigo catorze", unit: "un" },
  });
  itemId = i.json().item.id;
});

afterAll(async () => {
  await t.app.close();
});

describe("canais de entrada (webhooks)", () => {
  let shopifyToken: string;
  let wooToken: string;
  let genericToken: string;
  const SHOPIFY_SECRET = "shp_secret_123";
  const WOO_SECRET = "woo_secret_456";
  const GENERIC_SECRET = "gen_secret_789";

  it("cria canais por fonte e devolve o URL de entrada", async () => {
    for (const [source, secret, set] of [
      ["shopify", SHOPIFY_SECRET, (v: string) => (shopifyToken = v)],
      ["woocommerce", WOO_SECRET, (v: string) => (wooToken = v)],
      ["generic", GENERIC_SECRET, (v: string) => (genericToken = v)],
    ] as const) {
      const res = await authed("/api/integrations/inbound-channels", {
        method: "POST",
        payload: { name: `Canal ${source}`, source, secret },
      });
      expect(res.statusCode).toBe(201);
      const ch = res.json().channel;
      expect(ch.source).toBe(source);
      expect(ch.url).toBe(`/api/inbound/${ch.token}`);
      set(ch.token);
    }
    const list = await authed("/api/integrations/inbound-channels");
    expect(list.json().items).toHaveLength(3);
  });

  const shopifyPayload = {
    id: 555001,
    name: "#1001",
    email: "ana@loja.test",
    shipping_address: {
      first_name: "Ana",
      last_name: "Costa",
      address1: "Rua X 1",
      city: "Lisboa",
      zip: "1100-001",
      country_code: "PT",
    },
    line_items: [
      { sku: "F14-001", name: "Artigo catorze", quantity: 2, price: "10.00" },
      { name: "Produto sem SKU", quantity: 1, price: "5.00" },
    ],
  };

  it("aceita webhook Shopify com assinatura válida e mapeia a encomenda", async () => {
    const res = await hook(shopifyToken, SHOPIFY_SECRET, shopifyPayload, "x-shopify-hmac-sha256");
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.duplicate).toBe(false);
    expect(body.order.externalRef).toBe("shopify:#1001");

    const detail = await authed(`/api/orders/${body.order.id}`);
    const order = detail.json().order;
    expect(order.customerName).toBe("Ana Costa");
    expect(order.lines[0].itemId).toBe(itemId);
    expect(order.lines[1].itemId).toBeNull();
  });

  it("é idempotente: o mesmo webhook devolve a encomenda existente", async () => {
    const res = await hook(shopifyToken, SHOPIFY_SECRET, shopifyPayload, "x-shopify-hmac-sha256");
    expect(res.statusCode).toBe(200);
    expect(res.json().duplicate).toBe(true);
  });

  it("rejeita assinatura Shopify inválida", async () => {
    const raw = JSON.stringify(shopifyPayload);
    const res = await t.app.inject({
      method: "POST",
      url: `/api/inbound/${shopifyToken}`,
      headers: { "content-type": "application/json", "x-shopify-hmac-sha256": "assinatura-falsa" },
      payload: raw,
    });
    expect(res.statusCode).toBe(401);
  });

  it("aceita webhook WooCommerce com assinatura válida", async () => {
    const payload = {
      id: 42,
      number: "42",
      billing: { email: "joao@loja.test" },
      shipping: {
        first_name: "João",
        last_name: "Silva",
        address_1: "Rua 2",
        city: "Porto",
        postcode: "4000-100",
        country: "PT",
      },
      line_items: [{ sku: "F14-001", name: "Artigo catorze", quantity: 3, total: "30.00" }],
    };
    const res = await hook(wooToken, WOO_SECRET, payload, "x-wc-webhook-signature");
    expect(res.statusCode).toBe(201);
    expect(res.json().order.externalRef).toBe("woocommerce:42");

    const detail = await authed(`/api/orders/${res.json().order.id}`);
    expect(detail.json().order.lines[0].quantity).toBe(3);
  });

  it("canal genérico aceita payload já normalizado com assinatura hex", async () => {
    const payload = {
      externalRef: "EDI-777",
      customer: { name: "ERP Sinal Lda", taxId: "509990132" },
      lines: [{ sku: "F14-001", quantity: 1 }],
    };
    const res = await hook(genericToken, GENERIC_SECRET, payload, "x-transitum-signature", "hex");
    expect(res.statusCode).toBe(201);
    expect(res.json().order.externalRef).toBe("EDI-777");
  });

  it("token desconhecido devolve 404", async () => {
    const res = await hook("tk_inexistente_1234567890123456789012", "x", {}, "x-transitum-signature", "hex");
    expect(res.statusCode).toBe(404);
  });

  it("canal inativo deixa de receber", async () => {
    const list = await authed("/api/integrations/inbound-channels");
    const ch = list.json().items.find((c: { name: string }) => c.name === "Canal generic");
    await authed(`/api/integrations/inbound-channels/${ch.id}`, {
      method: "PATCH",
      payload: { active: false },
    });
    const res = await hook(genericToken, GENERIC_SECRET, { a: 1 }, "x-transitum-signature", "hex");
    expect(res.statusCode).toBe(404);
  });
});

describe("lotes com validade e FEFO", () => {
  it("regista entradas com lote e lista por validade", async () => {
    const past = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const future = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);

    const r1 = await authed("/api/movements", {
      method: "POST",
      payload: { type: "in", itemId, warehouseId, quantity: 10, lotCode: "L1", lotExpiresAt: past },
    });
    expect(r1.statusCode).toBe(201);
    expect(r1.json().movement.lotCode).toBe("L1");

    await authed("/api/movements", {
      method: "POST",
      payload: { type: "in", itemId, warehouseId, quantity: 5, lotCode: "L2", lotExpiresAt: future },
    });
    await authed("/api/movements", {
      method: "POST",
      payload: { type: "in", itemId, warehouseId, quantity: 4 },
    });

    const res = await authed(`/api/stock/lots?itemId=${itemId}`);
    expect(res.statusCode).toBe(200);
    const lots = res.json().items;
    expect(lots).toHaveLength(2);
    expect(lots[0].code).toBe("L1");
    expect(lots[0].daysToExpiry).toBeLessThan(0);
    expect(lots[1].code).toBe("L2");
  });

  it("a saída manual consome lotes por FEFO", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: { type: "out", itemId, warehouseId, quantity: 12 },
    });
    expect(res.statusCode).toBe(201);
    const m = res.json().movement;
    expect(m.lotCode).toBe("L1");
    expect(m.note).toContain("L1×10");
    expect(m.note).toContain("L2×2");

    const lots = await authed(`/api/stock/lots?itemId=${itemId}`);
    const l2 = lots.json().items.find((l: { code: string }) => l.code === "L2");
    expect(l2.onHand).toBe(3);
    // L1 ficou a 0 — já não aparece na lista (onHand > 0)
    expect(lots.json().items.find((l: { code: string }) => l.code === "L1")).toBeUndefined();
  });

  it("rejeita lote em saídas e validade sem código de lote", async () => {
    const r1 = await authed("/api/movements", {
      method: "POST",
      payload: { type: "out", itemId, warehouseId, quantity: 1, lotCode: "L9" },
    });
    expect(r1.statusCode).toBe(400);
    const r2 = await authed("/api/movements", {
      method: "POST",
      payload: { type: "in", itemId, warehouseId, quantity: 1, lotExpiresAt: "2027-01-01" },
    });
    expect(r2.statusCode).toBe(400);
  });
});

describe("wave picking", () => {
  it("agrega linhas por artigo, ordena por localização e detalha por encomenda", async () => {
    const loc = await authed(`/api/warehouses/${warehouseId}/locations`, {
      method: "POST",
      payload: { code: "P-01", zone: "Z" },
    });
    await authed(`/api/warehouses/${warehouseId}/pick-locations`, {
      method: "PUT",
      payload: { itemId, locationId: loc.json().location.id },
    });

    const mk = async (qty: number) => {
      const o = await authed("/api/orders", {
        method: "POST",
        payload: {
          customerId,
          warehouseId,
          lines: [
            { itemId, quantity: qty },
            { description: "Notas de entrega", quantity: 1 },
          ],
        },
      });
      const id = o.json().order.id;
      await authed(`/api/orders/${id}`, { method: "PATCH", payload: { status: "confirmed" } });
      return o.json().order.number;
    };
    const n1 = await mk(2);
    const n2 = await mk(3);

    // IDs precisam de ser lidos da lista (números ≠ ids)
    const list = await authed("/api/orders?pageSize=50");
    const ids = list
      .json()
      .items.filter((o: { number: string }) => [n1, n2].includes(o.number))
      .map((o: { id: string }) => o.id);

    const res = await authed("/api/orders/pick-wave", {
      method: "POST",
      payload: { orderIds: ids },
    });
    expect(res.statusCode).toBe(200);
    const wave = res.json().wave;
    expect(wave.orders).toHaveLength(2);
    expect(wave.warehouseName).toBe("Armazém F14");

    const artigo = wave.lines.find((l: { sku: string | null }) => l.sku === "F14-001");
    expect(artigo.toPick).toBe(5);
    expect(artigo.location).toBe("Z-P-01");
    expect(artigo.orders).toHaveLength(2);
    // Linha de texto sem localização fica no fim do percurso
    const last = wave.lines[wave.lines.length - 1];
    expect(last.itemName).toBe("Notas de entrega");
    expect(last.location).toBeNull();
  });
});

describe("criação de encomendas no portal", () => {
  let portalToken: string;

  it("cria encomenda em rascunho associada ao cliente do token", async () => {
    const link = await authed(`/api/partners/${customerId}/portal-link`, { method: "POST" });
    portalToken = link.json().portalToken;

    const res = await t.app.inject({
      method: "POST",
      url: `/api/portal/${portalToken}/orders`,
      payload: {
        requestedDate: "2026-12-01",
        notes: "Entregar de manhã",
        lines: [
          { sku: "F14-001", quantity: 2 },
          { description: "Embrulho oferta", quantity: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json().order;
    expect(created.status).toBe("draft");
    expect(created.lines).toBe(2);

    // A encomenda existe no backoffice, associada ao cliente do token
    const list = await authed(`/api/orders?q=${created.number}`);
    const row = list.json().items.find((o: { number: string }) => o.number === created.number);
    expect(row).toBeDefined();
    expect(row.customerName).toBe("Cliente Fase 14");

    const detail = await authed(`/api/orders/${row.id}`);
    expect(detail.json().order.lines[0].itemId).toBe(itemId);
    // Aparece no próprio portal como mais uma encomenda do cliente
    const portal = await t.app.inject({ method: "GET", url: `/api/portal/${portalToken}` });
    expect(portal.json().portal.orders[0].number).toBe(created.number);
  });

  it("rejeita token inválido e linhas vazias", async () => {
    const bad = await t.app.inject({
      method: "POST",
      url: "/api/portal/aaaaaaaaaaaaaaaaaaaaaaaa/orders",
      payload: { lines: [{ sku: "X" }] },
    });
    expect(bad.statusCode).toBe(404);

    const empty = await t.app.inject({
      method: "POST",
      url: `/api/portal/${portalToken}/orders`,
      payload: { lines: [{ sku: "", description: "" }] },
    });
    expect(empty.statusCode).toBe(400);
  });
});

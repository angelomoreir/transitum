import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registerTenant, type TestApp } from "./helpers.js";

/**
 * Fase 16 — IVA por linha e fiscalização de faturas de venda, reposição
 * exata de bins/séries no cancelamento, contagens serializadas, waves de
 * picking persistidas, SSO/OIDC por tenant e intake EDIFACT.
 */

let t: TestApp;
let token: string;
let customerId: string;
let warehouseId: string;
let warehouse2Id: string;
let itemId: string;
let serializedItemId: string;
let locationA: string;
let locationB: string;

const authed = (url: string, opts: { method?: string; payload?: unknown; bearer?: string } = {}) =>
  t.app.inject({
    method: opts.method ?? "GET",
    url,
    headers: { authorization: `Bearer ${opts.bearer ?? token}` },
    payload: opts.payload as Record<string, unknown> | undefined,
  });

const addr = { line1: "Rua A 1", city: "Lisboa", postalCode: "1100-001", country: "PT" };

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  token = res.json().accessToken;

  const c = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["customer"], name: "Cliente Fase 16" },
  });
  customerId = c.json().partner.id;

  const wh = await authed("/api/warehouses", { method: "POST", payload: { name: "Armazém F16" } });
  warehouseId = wh.json().warehouse.id;
  const wh2 = await authed("/api/warehouses", { method: "POST", payload: { name: "Armazém F16-B" } });
  warehouse2Id = wh2.json().warehouse.id;

  const i = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F16-001", name: "Artigo dezasseis", unit: "un" },
  });
  itemId = i.json().item.id;
  const si = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F16-SER", name: "Serializado F16", unit: "un", serialized: true },
  });
  serializedItemId = si.json().item.id;
  await authed("/api/items", {
    method: "POST",
    payload: { sku: "F16-002", name: "Segundo artigo F16", unit: "un" },
  });

  const la = await authed(`/api/warehouses/${warehouseId}/locations`, {
    method: "POST",
    payload: { code: "A-01", zone: "A" },
  });
  locationA = la.json().location.id;
  const lb = await authed(`/api/warehouses/${warehouseId}/locations`, {
    method: "POST",
    payload: { code: "B-01", zone: "B" },
  });
  locationB = lb.json().location.id;
});

afterAll(async () => {
  await t.app.close();
});

describe("faturas com IVA e fiscalização", () => {
  let invoiceId: string;

  it("calcula subtotal, IVA e total por taxas diferentes", async () => {
    const res = await authed("/api/sales-invoices", {
      method: "POST",
      payload: {
        customerId,
        lines: [
          { description: "Transporte", quantity: 2, unitPrice: 100, taxRate: 23 },
          { description: "Livro técnico", quantity: 1, unitPrice: 50, taxRate: 6 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const inv = res.json().invoice;
    invoiceId = inv.id;
    expect(inv.subtotal).toBe(250);
    expect(inv.taxTotal).toBe(49); // 46 + 3
    expect(inv.total).toBe(299);
    expect(inv.lines[0].taxRate).toBe(23);
    expect(inv.lines[1].taxRate).toBe(6);
    expect(inv.lines[1].taxAmount).toBe(3);
  });

  it("emissão gera ATCUD e estado fiscal", async () => {
    const res = await authed(`/api/sales-invoices/${invoiceId}/status`, {
      method: "POST",
      payload: { status: "issued" },
    });
    expect(res.statusCode).toBe(200);
    const inv = res.json().invoice;
    expect(inv.status).toBe("issued");
    expect(inv.atcud).toMatch(/^\d+-\d+$/);
    expect(inv.atStatus).toBeTruthy();
  });

  it("PDF da fatura devolve application/pdf", async () => {
    const res = await authed(`/api/sales-invoices/${invoiceId}/pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.rawPayload.slice(0, 5).toString()).toBe("%PDF-");
  });
});

describe("reposição de bins/séries no cancelamento", () => {
  it("cancelamento repõe stock nos bins exatos da saída", async () => {
    // Stock: 10 em A-01 e 5 em B-01
    await authed("/api/movements", {
      method: "POST",
      payload: { type: "in", itemId, warehouseId, quantity: 10, locationId: locationA },
    });
    await authed("/api/movements", {
      method: "POST",
      payload: { type: "in", itemId, warehouseId, quantity: 5, locationId: locationB },
    });

    // Encomenda de 7 → confirma (reserva) → expedição em trânsito consome
    const o = await authed("/api/orders", {
      method: "POST",
      payload: { customerId, warehouseId, lines: [{ itemId, quantity: 7 }] },
    });
    expect(o.statusCode).toBe(201);
    const orderId = o.json().order.id;
    await authed(`/api/orders/${orderId}`, {
      method: "PATCH",
      payload: { status: "confirmed" },
    });
    const detail = await authed(`/api/orders/${orderId}`);
    const orderLineId = detail.json().order.lines[0].id;

    const sh = await authed("/api/shipments", {
      method: "POST",
      payload: {
        orderId,
        customerId,
        pickupAddress: addr,
        deliveryAddress: addr,
        lines: [{ orderLineId, quantity: 7 }],
      },
    });
    expect(sh.statusCode).toBe(201);
    const shId = sh.json().shipment.id;
    await authed(`/api/shipments/${shId}/status`, {
      method: "POST",
      payload: { status: "planned" },
    });
    const transit = await authed(`/api/shipments/${shId}/status`, {
      method: "POST",
      payload: { status: "in_transit" },
    });
    expect(transit.statusCode).toBe(200);

    // Os bins foram consumidos
    const during = await authed(`/api/stock/bin-levels?warehouseId=${warehouseId}&itemId=${itemId}`);
    const sumDuring = during.json().items.reduce(
      (s: number, b: { onHand: number }) => s + b.onHand,
      0,
    );
    expect(sumDuring).toBe(8);

    // Cancela → repõe exatamente onde saiu
    const cancel = await authed(`/api/shipments/${shId}/status`, {
      method: "POST",
      payload: { status: "cancelled" },
    });
    expect(cancel.statusCode).toBe(200);
    const after = await authed(`/api/stock/bin-levels?warehouseId=${warehouseId}&itemId=${itemId}`);
    const a = after.json().items.find(
      (b: { locationId: string }) => b.locationId === locationA,
    );
    const b = after.json().items.find(
      (x: { locationId: string }) => x.locationId === locationB,
    );
    expect(a.onHand + b.onHand).toBe(15);
    // E o nível total do armazém volta a bater certo com os bins
    const recon = await authed(
      `/api/stock/reconciliation?warehouseId=${warehouseId}&discrepantOnly=true`,
    );
    expect(
      recon.json().items.find((r: { itemId: string }) => r.itemId === itemId),
    ).toBeUndefined();
  });
});

describe("contagens serializadas", () => {
  let countId: string;

  beforeAll(async () => {
    // Entrada de 3 séries no armazém principal e 1 no secundário
    const res = await authed("/api/movements", {
      method: "POST",
      payload: {
        type: "in",
        itemId: serializedItemId,
        warehouseId,
        quantity: 3,
        serials: ["F16-S1", "F16-S2", "F16-S3"],
      },
    });
    expect(res.statusCode).toBe(201);
    const res2 = await authed("/api/movements", {
      method: "POST",
      payload: {
        type: "in",
        itemId: serializedItemId,
        warehouseId: warehouse2Id,
        quantity: 1,
        serials: ["F16-SX"],
      },
    });
    expect(res2.statusCode).toBe(201);

    const c = await authed("/api/inventory-counts", {
      method: "POST",
      payload: { warehouseId, itemIds: [serializedItemId] },
    });
    expect(c.statusCode).toBe(201);
    countId = c.json().count.id;
    expect(c.json().count.lines[0].expectedQty).toBe(3);
    expect(c.json().count.lines[0].expectedSerials).toEqual(
      expect.arrayContaining(["F16-S1", "F16-S2", "F16-S3"]),
    );
  });

  it("rejeita séries duplicadas e séries noutro armazém", async () => {
    const dup = await authed(`/api/inventory-counts/${countId}/lines`, {
      method: "PATCH",
      payload: { lines: [{ itemId: serializedItemId, countedQty: 2, serials: ["F16-S1", "F16-S1"] }] },
    });
    expect(dup.statusCode).toBe(400);

    const cross = await authed(`/api/inventory-counts/${countId}/lines`, {
      method: "PATCH",
      payload: { lines: [{ itemId: serializedItemId, countedQty: 1, serials: ["F16-SX"] }] },
    });
    expect(cross.statusCode).toBe(400);
  });

  it("aplicar: séries em falta → written_off, desconhecidas → in_stock", async () => {
    // Contadas 2: S1 (esperada) + S9 (não registada). S2 e S3 ficam em falta.
    const patch = await authed(`/api/inventory-counts/${countId}/lines`, {
      method: "PATCH",
      payload: {
        lines: [{ itemId: serializedItemId, countedQty: 2, serials: ["F16-S1", "F16-S9"] }],
      },
    });
    expect(patch.statusCode).toBe(200);

    const apply = await authed(`/api/inventory-counts/${countId}/apply`, { method: "POST" });
    expect(apply.statusCode).toBe(200);
    expect(apply.json().count.status).toBe("applied");

    const serials = await authed(`/api/stock/serials?itemId=${serializedItemId}`);
    const bySerial = Object.fromEntries(
      serials.json().items.map((s: { serial: string; status: string }) => [s.serial, s.status]),
    );
    expect(bySerial["F16-S1"]).toBe("in_stock");
    expect(bySerial["F16-S9"]).toBe("in_stock");
    expect(bySerial["F16-S2"]).toBe("written_off");
    expect(bySerial["F16-S3"]).toBe("written_off");
    expect(bySerial["F16-SX"]).toBe("in_stock"); // armazém B intocado
  });
});

describe("waves de picking persistidas", () => {
  let waveId: string;
  let waveLineId: string;

  beforeAll(async () => {
    const o = await authed("/api/orders", {
      method: "POST",
      payload: {
        customerId,
        warehouseId,
        lines: [{ itemId, quantity: 2, unitPrice: 10 }],
      },
    });
    const orderId = o.json().order.id;
    await authed(`/api/orders/${orderId}`, {
      method: "PATCH",
      payload: { status: "confirmed" },
    });
    const res = await authed("/api/pick-waves", {
      method: "POST",
      payload: { orderIds: [orderId] },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
    const wave = res.json().wave;
    waveId = wave.id;
    expect(wave.number).toMatch(/^WV-\d{5}$/);
    expect(wave.status).toBe("open");
    expect(wave.lines).toHaveLength(1);
    waveLineId = wave.lines[0].id;
  });

  it("lista e detalhe por tenant", async () => {
    const list = await authed("/api/pick-waves");
    expect(list.json().items.some((w: { id: string }) => w.id === waveId)).toBe(true);

    const { res: other } = await registerTenant(t.app);
    const otherDetail = await authed(`/api/pick-waves/${waveId}`, {
      bearer: other.json().accessToken,
    });
    expect(otherDetail.statusCode).toBe(404);
  });

  it("transições inválidas são rejeitadas", async () => {
    const res = await authed(`/api/pick-waves/${waveId}`, {
      method: "PATCH",
      payload: { status: "done" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("registo parcial → in_progress; total → done automático", async () => {
    const partial = await authed(`/api/pick-waves/${waveId}/lines`, {
      method: "PATCH",
      payload: { lines: [{ id: waveLineId, pickedQty: 1 }] },
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.json().wave.status).toBe("in_progress");

    const full = await authed(`/api/pick-waves/${waveId}/lines`, {
      method: "PATCH",
      payload: { lines: [{ id: waveLineId, pickedQty: 2 }] },
    });
    expect(full.json().wave.status).toBe("done");
    expect(full.json().wave.completedAt).toBeTruthy();
  });

  it("linhas depois de fechada são rejeitadas", async () => {
    const res = await authed(`/api/pick-waves/${waveId}/lines`, {
      method: "PATCH",
      payload: { lines: [{ id: waveLineId, pickedQty: 0 }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("SSO/OIDC", () => {
  let providerId: string;
  const SSO_DOMAIN = "sso-f16.pt";

  it("cria, lista, atualiza e apaga fornecedor", async () => {
    const res = await authed("/api/sso-providers", {
      method: "POST",
      payload: {
        name: "Entra ID teste",
        domain: SSO_DOMAIN,
        clientId: "cid-123",
        clientSecret: "segredo-sso",
        authorizeUrl: "https://idp.example.com/authorize",
        tokenUrl: "https://idp.example.com/token",
        autoProvision: false,
        defaultRole: "viewer",
      },
    });
    expect(res.statusCode).toBe(201);
    providerId = res.json().provider.id;
    expect(res.json().provider.domain).toBe(SSO_DOMAIN);
    expect(res.json().provider.redirectUri).toContain("/api/auth/sso/callback");
    expect(res.json().provider).not.toHaveProperty("clientSecret");

    const dup = await authed("/api/sso-providers", {
      method: "POST",
      payload: {
        name: "Dup",
        domain: SSO_DOMAIN,
        clientId: "c2",
        clientSecret: "s3cr3t",
        authorizeUrl: "https://x.example.com/a",
        tokenUrl: "https://x.example.com/t",
      },
    });
    expect(dup.statusCode).toBe(400);
  });

  it("lookup por domínio de email devolve startUrl", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/sso/lookup",
      payload: { email: `alguem@${SSO_DOMAIN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sso).toBe(true);
    expect(res.json().providerId).toBe(providerId);
    expect(res.json().startUrl).toContain(`/api/auth/sso/${providerId}/start`);

    const miss = await t.app.inject({
      method: "POST",
      url: "/api/auth/sso/lookup",
      payload: { email: "x@outro-dominio.pt" },
    });
    expect(miss.json().sso).toBe(false);
  });

  it("start redireciona para o IdP com state", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: `/api/auth/sso/${providerId}/start`,
    });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc).toContain("https://idp.example.com/authorize");
    expect(loc).toContain("state=");
    expect(loc).toContain("redirect_uri=");
  });

  it("callback com state desconhecido → erro de sessão", async () => {
    const res = await t.app.inject({
      method: "GET",
      url: "/api/auth/sso/callback?code=abc&state=desconhecido",
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("sso_error=state");
  });

  it("fornecedor desativado deixa de aparecer no lookup", async () => {
    await authed(`/api/sso-providers/${providerId}`, {
      method: "PATCH",
      payload: { enabled: false },
    });
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/sso/lookup",
      payload: { email: `x@${SSO_DOMAIN}` },
    });
    expect(res.json().sso).toBe(false);
    await authed(`/api/sso-providers/${providerId}`, { method: "DELETE" });
  });
});

describe("EDI — intake EDIFACT ORDERS", () => {
  let ediToken: string;
  const EDI_SECRET = "edi_segredo_16";
  const EDI_MESSAGE = [
    "UNB+UNOA:2+SENDER1+TRANSITUM+250101:1200+0001",
    "UNH+1+ORDERS:D:96A:UN",
    "BGM+220+PO-EDI-001+9",
    "DTM+2:20300115:102",
    "NAD+BY+++Cliente EDI SA",
    "NAD+DP++++Rua do EDI 10+Porto++4000-001+PT",
    "LIN+1++F16-001:EN",
    "IMD+++:::Caixa de artigos",
    "QTY+21:4:PCE",
    "LIN+2++F16-002:EN",
    "QTY+21:2:PCE",
    "UNT+10+1",
    "UNZ+1+0001",
  ].join("'") + "'";

  const edi = (body: string, sig?: string) =>
    t.app.inject({
      method: "POST",
      url: `/api/inbound/${ediToken}`,
      headers: {
        "content-type": "text/plain",
        ...(sig ? { "x-transitum-signature": sig } : {}),
      },
      payload: body,
    });

  it("cria canal 'edifact'", async () => {
    const res = await authed("/api/integrations/inbound-channels", {
      method: "POST",
      payload: { name: "EDI cliente", source: "edifact", secret: EDI_SECRET },
    });
    expect(res.statusCode).toBe(201);
    ediToken = res.json().channel.token;
    expect(res.json().channel.source).toBe("edifact");
  });

  it("mensagem ORDERS assinada cria encomenda", async () => {
    const sig = createHmac("sha256", EDI_SECRET).update(EDI_MESSAGE, "utf8").digest("hex");
    const res = await edi(EDI_MESSAGE, sig);
    expect(res.statusCode).toBe(201);
    const order = res.json().order;
    expect(order.externalRef).toBe("edifact:SENDER1:PO-EDI-001");
    expect(order.status).toBe("draft");

    // Linhas mapeadas: SKU conhecido + segundo artigo
    const detail = await authed(`/api/orders/${order.id}`);
    expect(detail.json().order.lines).toHaveLength(2);
    expect(detail.json().order.requestedDate).toBe("2030-01-15");
  });

  it("re-envio é idempotente (duplicate)", async () => {
    const sig = createHmac("sha256", EDI_SECRET).update(EDI_MESSAGE, "utf8").digest("hex");
    const res = await edi(EDI_MESSAGE, sig);
    expect(res.statusCode).toBe(200);
    expect(res.json().duplicate).toBe(true);
  });

  it("assinatura inválida → 401", async () => {
    const res = await edi(EDI_MESSAGE, "assinatura-errada");
    expect(res.statusCode).toBe(401);
  });

  it("texto não EDIFACT → 400", async () => {
    const body = "isto nao e edifact";
    const sig = createHmac("sha256", EDI_SECRET).update(body, "utf8").digest("hex");
    const res = await edi(body, sig);
    expect(res.statusCode).toBe(400);
  });
});

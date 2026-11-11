import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { totp } from "../src/lib/totp.js";
import { createTestApp, registerTenant, type TestApp } from "./helpers.js";

/**
 * Fase 11 — MFA/TOTP (enroll, desafio no login, verify), auditoria de faturas
 * de frete com scorecard no relatório, importação CSV de encomendas e
 * contagem física de stock.
 */

let t: TestApp;
let token: string;
let email: string;
let password: string;
let customerId: string;
let carrierId: string;
let warehouseId: string;
let itemId: string;
let item2Id: string;

const authed = (url: string, opts: { method?: string; payload?: unknown; bearer?: string } = {}) =>
  t.app.inject({
    method: opts.method ?? "GET",
    url,
    headers: { authorization: `Bearer ${opts.bearer ?? token}` },
    payload: opts.payload as Record<string, unknown> | undefined,
  });

beforeAll(async () => {
  t = await createTestApp();
  const { res, body } = await registerTenant(t.app);
  token = res.json().accessToken;
  email = body.email;
  password = body.password;

  const c = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["customer"], name: "Cliente Fase 11" },
  });
  customerId = c.json().partner.id;
  const tr = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["carrier"], name: "Transportadora F11" },
  });
  carrierId = tr.json().partner.id;

  const wh = await authed("/api/warehouses", {
    method: "POST",
    payload: { name: "Armazém F11" },
  });
  warehouseId = wh.json().warehouse.id;

  const i1 = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F11-001", name: "Artigo onze", unit: "un", weightKg: 2 },
  });
  itemId = i1.json().item.id;
  const i2 = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F11-002", name: "Artigo doze", unit: "cx" },
  });
  item2Id = i2.json().item.id;

  await authed("/api/movements", {
    method: "POST",
    payload: { type: "in", itemId, warehouseId, quantity: 20 },
  });
  await authed("/api/movements", {
    method: "POST",
    payload: { type: "in", itemId: item2Id, warehouseId, quantity: 5 },
  });
});

afterAll(async () => {
  await t.app.close();
});

describe("MFA/TOTP", () => {
  let secret = "";
  let mfaToken = "";

  it("gera segredo e ativa com código válido", async () => {
    const setup = await authed("/api/auth/mfa/setup", { method: "POST" });
    expect(setup.statusCode).toBe(200);
    secret = setup.json().secret;
    expect(secret).toMatch(/^[A-Z2-7]{20,}$/);
    expect(setup.json().otpauth).toContain("otpauth://totp/");

    const bad = await authed("/api/auth/mfa/enable", {
      method: "POST",
      payload: { code: "000000" },
    });
    expect(bad.statusCode).toBe(400);

    const enable = await authed("/api/auth/mfa/enable", {
      method: "POST",
      payload: { code: totp(secret) },
    });
    expect(enable.statusCode).toBe(200);
  });

  it("login devolve desafio MFA em vez de sessão", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mfaRequired).toBe(true);
    expect(body.mfaToken).toBeTruthy();
    expect(body.accessToken).toBeUndefined();
    mfaToken = body.mfaToken;
  });

  it("mfaToken não funciona como token de acesso", async () => {
    const res = await authed("/api/auth/me", { bearer: mfaToken });
    expect(res.statusCode).toBe(401);
  });

  it("verify com código errado falha; código correto emite sessão", async () => {
    const bad = await t.app.inject({
      method: "POST",
      url: "/api/auth/mfa/verify",
      payload: { mfaToken, code: "000000" },
    });
    expect(bad.statusCode).toBe(401);

    const ok = await t.app.inject({
      method: "POST",
      url: "/api/auth/mfa/verify",
      payload: { mfaToken, code: totp(secret) },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.user.totpEnabled).toBe(true);
  });
});

describe("auditoria de faturas de frete", () => {
  let shipmentId: string;

  beforeAll(async () => {
    const sh = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        carrierId,
        pickupAddress: { line1: "Rua A 1", city: "Lisboa", postalCode: "1100-001", country: "PT" },
        deliveryAddress: { line1: "Rua B 2", city: "Porto", postalCode: "4000-001", country: "PT" },
      },
    });
    shipmentId = sh.json().shipment.id;
    await authed(`/api/shipments/${shipmentId}/costs`, {
      method: "POST",
      payload: { type: "freight", amount: 100, currency: "EUR", description: "Frete" },
    });
  });

  it("fatura igual ao esperado fica conforme; diferente gera discrepância", async () => {
    const okRes = await authed("/api/freight-invoices", {
      method: "POST",
      payload: { carrierId, shipmentId, invoiceNumber: "FAT-1", amount: 100 },
    });
    expect(okRes.statusCode).toBe(201);
    expect(okRes.json().invoice.status).toBe("matched");
    expect(okRes.json().invoice.variance).toBe(0);

    const badRes = await authed("/api/freight-invoices", {
      method: "POST",
      payload: { carrierId, shipmentId, invoiceNumber: "FAT-2", amount: 135.5 },
    });
    expect(badRes.statusCode).toBe(201);
    const inv = badRes.json().invoice;
    expect(inv.status).toBe("discrepancy");
    expect(inv.variance).toBe(35.5);
    expect(inv.expectedAmount).toBe(100);
  });

  it("fatura sem expedição fica pendente", async () => {
    const res = await authed("/api/freight-invoices", {
      method: "POST",
      payload: { carrierId, invoiceNumber: "FAT-3", amount: 50 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().invoice.status).toBe("pending");
    expect(res.json().invoice.variance).toBeNull();
  });

  it("lista com resumo por estado", async () => {
    const res = await authed("/api/freight-invoices");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary.matched).toBe(1);
    expect(body.summary.discrepancy).toBe(1);
    expect(body.summary.pending).toBe(1);
    expect(body.summary.totalVariance).toBe(35.5);

    const filtered = await authed("/api/freight-invoices?status=discrepancy");
    expect(filtered.json().items).toHaveLength(1);
  });

  it("scorecard do relatório inclui POD e discrepâncias por transportadora", async () => {
    const res = await authed("/api/reports/overview");
    expect(res.statusCode).toBe(200);
    const carrier = res.json().report.carriers.find(
      (c: { carrierId: string }) => c.carrierId === carrierId,
    );
    expect(carrier).toBeDefined();
    expect(carrier.invoices).toBe(3);
    expect(carrier.invoiceDiscrepancies).toBe(1);
  });
});

describe("importação CSV de encomendas", () => {
  it("agrupa linhas por referência e resolve cliente + SKU", async () => {
    const csv = [
      "encomenda;cliente;sku;descricao;quantidade;preco;cidade;pais",
      "EXT-1;Cliente Fase 11;F11-001;;3;10.5;Lisboa;PT",
      "EXT-1;Cliente Fase 11;F11-002;;2;25;Lisboa;PT",
      "EXT-2;Cliente Fase 11;;Serviço manual;5;;Porto;PT",
      "EXT-3;Cliente Inexistente;F11-001;;1;;Lisboa;PT",
      "EXT-4;Cliente Fase 11;SKU-INEXISTENTE;;1;;Lisboa;PT",
    ].join("\n");
    const res = await authed("/api/orders/import", { method: "POST", payload: { csv } });
    expect(res.statusCode).toBe(200);
    const { imported, errors } = res.json();
    expect(imported).toBe(2);
    expect(errors).toHaveLength(2);
    // Erros reportados na primeira linha de cada grupo
    expect(errors.map((e: { row: number }) => e.row)).toEqual([5, 6]);

    const list = await authed("/api/orders?q=Cliente Fase 11&pageSize=50");
    const imported1 = list.json().items.find(
      (o: { deliveryCity: string }) => o.deliveryCity === "Lisboa",
    );
    const detail = await authed(`/api/orders/${imported1.id}`);
    const order = detail.json().order;
    expect(order.status).toBe("draft");
    expect(order.lines).toHaveLength(2);
    expect(order.lines[0].sku).toBe("F11-001");
    // Peso derivado do artigo (2 kg × 3)
    expect(order.lines[0].weightKg).toBe(6);
    expect(order.totalValue).toBe(3 * 10.5 + 2 * 25);
  });
});

describe("contagem física de stock", () => {
  let countId: string;

  it("cria contagem com snapshot do stock do armazém", async () => {
    const res = await authed("/api/inventory-counts", {
      method: "POST",
      payload: { warehouseId },
    });
    expect(res.statusCode).toBe(201);
    const count = res.json().count;
    countId = count.id;
    expect(count.status).toBe("open");
    expect(count.lines).toHaveLength(2);
    const l1 = count.lines.find((l: { sku: string }) => l.sku === "F11-001");
    expect(l1.expectedQty).toBe(20);
  });

  it("regista quantidades e aplica ajustes como movimentos adjust", async () => {
    const patch = await authed(`/api/inventory-counts/${countId}/lines`, {
      method: "PATCH",
      payload: {
        lines: [
          { itemId, countedQty: 18 },
          { itemId: item2Id, countedQty: 7 },
        ],
      },
    });
    expect(patch.statusCode).toBe(200);
    const l1 = patch.json().count.lines.find((l: { sku: string }) => l.sku === "F11-001");
    expect(l1.variance).toBe(-2);

    const apply = await authed(`/api/inventory-counts/${countId}/apply`, { method: "POST" });
    expect(apply.statusCode).toBe(200);
    expect(apply.json().count.status).toBe("applied");

    // Stock ajustado: 20→18 e 5→7
    const stock = await authed(`/api/stock?warehouseId=${warehouseId}`);
    const s1 = stock.json().items.find((s: { sku: string }) => s.sku === "F11-001");
    const s2 = stock.json().items.find((s: { sku: string }) => s.sku === "F11-002");
    expect(s1.onHand).toBe(18);
    expect(s2.onHand).toBe(7);

    const movs = await authed("/api/movements?type=adjust");
    const adjusts = movs.json().items.filter((m: { reference: string }) =>
      m.reference?.startsWith("CNT-"),
    );
    expect(adjusts).toHaveLength(2);
  });

  it("não aplica duas vezes nem cancela uma contagem aplicada", async () => {
    const again = await authed(`/api/inventory-counts/${countId}/apply`, { method: "POST" });
    expect(again.statusCode).toBe(400);
    const cancel = await authed(`/api/inventory-counts/${countId}/cancel`, { method: "POST" });
    expect(cancel.statusCode).toBe(400);
  });

  it("anular uma contagem aberta funciona", async () => {
    const res = await authed("/api/inventory-counts", {
      method: "POST",
      payload: { warehouseId },
    });
    const id = res.json().count.id;
    const cancel = await authed(`/api/inventory-counts/${id}/cancel`, { method: "POST" });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().count.status).toBe("cancelled");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { alertLateShipments } from "../src/lib/scheduler.js";
import { createTestApp, registerTenant, type TestApp } from "./helpers.js";

/**
 * Fase 13 — localizações/bins com picking dirigido, intake EDI
 * (/api/v1/inbound-orders idempotente + stock na v1), portal do cliente,
 * alertas de atraso no scheduler e estimativa de CO₂.
 */

let t: TestApp;
let token: string;
let apiKey: string;
let customerId: string;
let warehouseId: string;
let warehouseCode: string;
let itemId: string;

const authed = (url: string, opts: { method?: string; payload?: unknown; bearer?: string } = {}) =>
  t.app.inject({
    method: opts.method ?? "GET",
    url,
    headers: { authorization: `Bearer ${opts.bearer ?? token}` },
    payload: opts.payload as Record<string, unknown> | undefined,
  });

const v1 = (url: string, opts: { method?: string; payload?: unknown } = {}) =>
  t.app.inject({
    method: opts.method ?? "GET",
    url: `/api/v1${url}`,
    headers: { "x-api-key": apiKey },
    payload: opts.payload as Record<string, unknown> | undefined,
  });

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  token = res.json().accessToken;

  const c = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["customer"], name: "Cliente Fase 13" },
  });
  customerId = c.json().partner.id;

  const wh = await authed("/api/warehouses", {
    method: "POST",
    payload: { name: "Armazém F13" },
  });
  warehouseId = wh.json().warehouse.id;
  warehouseCode = wh.json().warehouse.code;

  const i1 = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F13-001", name: "Artigo treze", unit: "un" },
  });
  itemId = i1.json().item.id;

  await authed("/api/movements", {
    method: "POST",
    payload: { type: "in", itemId, warehouseId, quantity: 20 },
  });

  const key = await authed("/api/integrations/keys", {
    method: "POST",
    payload: { name: "EDI test" },
  });
  apiKey = key.json().secret;
});

afterAll(async () => {
  await t.app.close();
});

describe("localizações e picking dirigido", () => {
  let locationId: string;
  let locationBId: string;

  it("cria localizações e rejeita código duplicado no armazém", async () => {
    const res = await authed(`/api/warehouses/${warehouseId}/locations`, {
      method: "POST",
      payload: { code: "a-01-01", zone: "A" },
    });
    expect(res.statusCode).toBe(201);
    locationId = res.json().location.id;
    expect(res.json().location.code).toBe("A-01-01");

    const b = await authed(`/api/warehouses/${warehouseId}/locations`, {
      method: "POST",
      payload: { code: "B-01-01", zone: "B" },
    });
    locationBId = b.json().location.id;

    const dup = await authed(`/api/warehouses/${warehouseId}/locations`, {
      method: "POST",
      payload: { code: "A-01-01" },
    });
    expect(dup.statusCode).toBe(400);
  });

  it("atribui localização de picking e aparece ordenada na guia", async () => {
    const put = await authed(`/api/warehouses/${warehouseId}/pick-locations`, {
      method: "PUT",
      payload: { itemId, locationId },
    });
    expect(put.statusCode).toBe(200);

    const i2 = await authed("/api/items", {
      method: "POST",
      payload: { sku: "F13-002", name: "Artigo zona B", unit: "un" },
    });
    const item2Id = i2.json().item.id;
    await authed(`/api/warehouses/${warehouseId}/pick-locations`, {
      method: "PUT",
      payload: { itemId: item2Id, locationId: locationBId },
    });
    await authed("/api/movements", {
      method: "POST",
      payload: { type: "in", itemId: item2Id, warehouseId, quantity: 5 },
    });

    const ord = await authed("/api/orders", {
      method: "POST",
      payload: {
        customerId,
        warehouseId,
        lines: [
          { itemId: item2Id, quantity: 2 },
          { itemId, quantity: 3 },
        ],
      },
    });
    expect(ord.statusCode).toBe(201);
    const orderId = ord.json().order.id;

    const pick = await authed(`/api/orders/${orderId}/picklist`);
    expect(pick.statusCode).toBe(200);
    const lines = pick.json().pickList.lines;
    expect(lines).toHaveLength(2);
    // Ordenado por localização: zona A primeiro, depois zona B
    expect(lines[0].location).toBe("A-A-01-01");
    expect(lines[1].location).toBe("B-B-01-01");

    const list = await authed(`/api/warehouses/${warehouseId}/pick-locations`);
    expect(list.json().items).toHaveLength(2);
  });

  it("importa localizações por CSV e ignora duplicados", async () => {
    const res = await authed(`/api/warehouses/${warehouseId}/locations/import`, {
      method: "POST",
      payload: { csv: "codigo;zona\nC-01;A-01-01\nD-02;Z\nC-01;A" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toBe(2);
    expect(body.skipped).toBe(1);
  });
});

describe("intake EDI (v1 inbound-orders + stock)", () => {
  it("cria encomenda a partir de referências externas e cria o cliente", async () => {
    const res = await v1("/inbound-orders", {
      method: "POST",
      payload: {
        externalRef: "SHOP-1001",
        customer: { name: "Loja Externa Lda", taxId: "509990131" },
        warehouseCode,
        lines: [
          { sku: "F13-001", quantity: 4 },
          { sku: "DESCONHECIDO", description: "Produto externo", quantity: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.duplicate).toBe(false);
    expect(body.order.externalRef).toBe("SHOP-1001");

    const detail = await authed(`/api/orders/${body.order.id}`);
    const lines = detail.json().order.lines;
    expect(lines).toHaveLength(2);
    // SKU conhecido ligado ao artigo; desconhecido fica como texto
    expect(lines[0].itemId).toBe(itemId);
    expect(lines[1].itemId).toBeNull();
  });

  it("é idempotente: a mesma externalRef devolve a encomenda existente", async () => {
    const res = await v1("/inbound-orders", {
      method: "POST",
      payload: {
        externalRef: "SHOP-1001",
        customer: { name: "Loja Externa Lda" },
        lines: [{ description: "Duplicado", quantity: 9 }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().duplicate).toBe(true);
  });

  it("resolve cliente existente por NIF sem o duplicar", async () => {
    const res = await v1("/inbound-orders", {
      method: "POST",
      payload: {
        externalRef: "SHOP-1002",
        customer: { name: "Nome diferente", taxId: "509990131" },
        lines: [{ sku: "F13-001", quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const detail = await authed(`/api/orders/${res.json().order.id}`);
    expect(detail.json().order.customerName).toBe("Loja Externa Lda");
  });

  it("expõe níveis de stock na v1", async () => {
    const res = await v1("/stock");
    expect(res.statusCode).toBe(200);
    const row = res.json().items.find((s: { sku: string }) => s.sku === "F13-001");
    expect(row).toBeDefined();
    expect(row.onHand).toBe(20);
  });
});

describe("portal do cliente", () => {
  let portalToken: string;

  it("gera link do portal e lista encomendas e expedições do cliente", async () => {
    const link = await authed(`/api/partners/${customerId}/portal-link`, { method: "POST" });
    expect(link.statusCode).toBe(200);
    portalToken = link.json().portalToken;
    expect(link.json().portalUrl).toBe(`/portal/${portalToken}`);

    await authed("/api/orders", {
      method: "POST",
      payload: { customerId, lines: [{ itemId, quantity: 1 }] },
    });
    const ship = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        pickupAddress: { line1: "Rua A 1", city: "Porto", postalCode: "4000-001", country: "PT" },
        deliveryAddress: { line1: "Rua B 2", city: "Braga", postalCode: "4700-001", country: "PT" },
      },
    });
    expect(ship.statusCode).toBe(201);

    const res = await t.app.inject({ method: "GET", url: `/api/portal/${portalToken}` });
    expect(res.statusCode).toBe(200);
    const portal = res.json().portal;
    expect(portal.customerName).toBe("Cliente Fase 13");
    expect(portal.orders.length).toBeGreaterThanOrEqual(1);
    expect(portal.shipments.length).toBe(1);
    expect(portal.shipments[0].trackingUrl).toContain("/track/");
  });

  it("rejeita token inválido e respeita revogação", async () => {
    const bad = await t.app.inject({ method: "GET", url: "/api/portal/aaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(bad.statusCode).toBe(404);

    const revoke = await authed(`/api/partners/${customerId}/portal-link`, { method: "DELETE" });
    expect(revoke.statusCode).toBe(200);
    const gone = await t.app.inject({ method: "GET", url: `/api/portal/${portalToken}` });
    expect(gone.statusCode).toBe(404);
  });
});

describe("alertas de atraso e CO₂", () => {
  it("notifica expedições com entrega prevista ultrapassada", async () => {
    const ship = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        pickupAddress: { line1: "Rua A 1", city: "Porto", postalCode: "4000-001", country: "PT" },
        deliveryAddress: { line1: "Rua B 2", city: "Braga", postalCode: "4700-001", country: "PT" },
        plannedDeliveryAt: new Date(Date.now() - 86400_000).toISOString(),
      },
    });
    expect(ship.statusCode).toBe(201);
    await authed(`/api/shipments/${ship.json().shipment.id}/status`, {
      method: "POST",
      payload: { status: "planned" },
    });

    const n = await alertLateShipments(t.app.db);
    expect(n).toBe(1);
    // Segunda passagem não repete (lateAlertedAt)
    expect(await alertLateShipments(t.app.db)).toBe(0);

    const detail = await authed(`/api/shipments/${ship.json().shipment.id}`);
    const alertEvent = detail
      .json()
      .shipment.events.find((e: { type: string }) => e.type === "alert");
    expect(alertEvent).toBeDefined();

    const notifs = await authed("/api/notifications");
    const lateNotif = notifs
      .json()
      .items.find((x: { type: string }) => x.type === "shipment.late");
    expect(lateNotif).toBeDefined();
  });

  it("estima CO₂ a partir de distância × peso e soma no relatório", async () => {
    const ship = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        pickupAddress: { line1: "Rua A 1", city: "Porto", postalCode: "4000-001", country: "PT" },
        deliveryAddress: { line1: "Rua B 2", city: "Braga", postalCode: "4700-001", country: "PT" },
        totalWeightKg: 1000,
        distanceKm: 100,
      },
    });
    expect(ship.statusCode).toBe(201);
    const id = ship.json().shipment.id;

    const detail = await authed(`/api/shipments/${id}`);
    // 100 km × 1 t × 0.096 = 9.6 kg CO₂e
    expect(detail.json().shipment.estimatedCo2Kg).toBeCloseTo(9.6, 1);

    const rep = await authed("/api/reports/overview");
    expect(rep.json().report.shipments.estimatedCo2Kg).toBeGreaterThanOrEqual(9.6);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { routePositions, routeStops, shipments } from "../src/db/schema.js";
import { createTestApp, registerTenant, type TestApp } from "./helpers.js";

/**
 * Fase 10 — importação CSV em massa, pontos de reposição e alertas de rutura,
 * otimização de paragens (nearest-neighbor) e ETA no tracking público.
 */

let t: TestApp;
let token: string;
let tenantId: string;
let customerId: string;
let warehouseId: string;
let itemId: string;

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
  tenantId = res.json().tenant.id;

  const c = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["customer"], name: "Cliente Fase 10" },
  });
  customerId = c.json().partner.id;

  const wh = await authed("/api/warehouses", {
    method: "POST",
    payload: { name: "Armazém Norte" },
  });
  warehouseId = wh.json().warehouse.id;

  const it = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F10-001", name: "Artigo fase 10", unit: "un" },
  });
  itemId = it.json().item.id;

  await authed("/api/movements", {
    method: "POST",
    payload: { type: "in", itemId, warehouseId, quantity: 10 },
  });
});

afterAll(async () => {
  await t.app.close();
});

describe("importação CSV em massa", () => {
  it("importa parceiros com cabeçalhos em português e reporta erros por linha", async () => {
    const csv = [
      "tipos;nome;nif;email;cidade",
      "cliente;Importado Um;509990130;i1@teste.pt;Lisboa",
      "fornecedor|transportadora;Misto Dois;;m@teste.pt;Porto",
      "tipo-errado;Falha Três;;;",
    ].join("\n");
    const res = await authed("/api/partners/import", { method: "POST", payload: { csv } });
    expect(res.statusCode).toBe(200);
    const { imported, errors } = res.json();
    expect(imported).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(4);

    const list = await authed("/api/partners?q=Misto");
    const partner = list.json().items[0];
    expect(partner.types).toEqual(["supplier", "carrier"]);
  });

  it("importa artigos e salta SKUs duplicados", async () => {
    const csv = [
      "sku;nome;unidade;peso",
      "IMP-01;Parafuso importado;cx;1,5",
      "IMP-02;Porca importada;un;",
      "F10-001;Duplicado;un;",
      ";sem sku;un;",
    ].join("\n");
    const res = await authed("/api/items/import", { method: "POST", payload: { csv } });
    expect(res.statusCode).toBe(200);
    const { imported, errors } = res.json();
    expect(imported).toBe(2);
    expect(errors).toHaveLength(2);

    const list = await authed("/api/items?q=IMP-01");
    expect(list.json().items[0].weightKg).toBe(1.5);
  });

  it("rejeita CSV vazio", async () => {
    const res = await authed("/api/partners/import", {
      method: "POST",
      payload: { csv: "apenas;cabeçalho" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("ponto de reposição e alertas de stock", () => {
  it("define o ponto de reposição e gera alerta quando o disponível é insuficiente", async () => {
    // 10 em stock — sem alerta com ponto 5
    let res = await authed("/api/stock/reorder-point", {
      method: "PUT",
      payload: { itemId, warehouseId, reorderPoint: 5 },
    });
    expect(res.statusCode).toBe(200);
    let alerts = (await authed("/api/stock/alerts")).json().items;
    expect(alerts.find((a: { sku: string }) => a.sku === "F10-001")).toBeUndefined();

    // ponto acima do disponível → alerta com défice
    res = await authed("/api/stock/reorder-point", {
      method: "PUT",
      payload: { itemId, warehouseId, reorderPoint: 12 },
    });
    expect(res.statusCode).toBe(200);
    alerts = (await authed("/api/stock/alerts")).json().items;
    const alert = alerts.find((a: { sku: string }) => a.sku === "F10-001");
    expect(alert).toBeDefined();
    expect(alert.deficit).toBe(2);
    expect(alert.available).toBe(10);
  });

  it("limpar o ponto remove o alerta", async () => {
    await authed("/api/stock/reorder-point", {
      method: "PUT",
      payload: { itemId, warehouseId, reorderPoint: null },
    });
    const alerts = (await authed("/api/stock/alerts")).json().items;
    expect(alerts.find((a: { sku: string }) => a.sku === "F10-001")).toBeUndefined();
  });
});

describe("otimização de paragens", () => {
  const addr = (city: string) => ({
    line1: `Rua de ${city} 1`,
    city,
    postalCode: "1000-001",
    country: "PT",
  });

  it("reordena paragens pendentes por proximidade", async () => {
    // Ordem original: Lisboa → Madrid → Porto; o ótimo a partir de Lisboa
    // é Lisboa → Porto → Madrid
    const res = await authed("/api/routes", {
      method: "POST",
      payload: {
        name: "Rota otimização",
        stops: [
          { type: "delivery", address: addr("Lisboa") },
          { type: "delivery", address: addr("Madrid") },
          { type: "delivery", address: addr("Porto") },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const route = res.json().route;

    // O geocoder é noop em testes — injeta coordenadas diretamente
    const coords: Record<string, [number, number]> = {
      Lisboa: [38.72, -9.14],
      Madrid: [40.42, -3.7],
      Porto: [41.15, -8.61],
    };
    for (const s of route.stops as { id: string; address: { city: string } }[]) {
      const [lat, lng] = coords[s.address.city];
      await t.app.db
        .update(routeStops)
        .set({ lat, lng })
        .where(eq(routeStops.id, s.id));
    }

    const opt = await authed(`/api/routes/${route.id}/optimize`, { method: "POST", payload: {} });
    expect(opt.statusCode).toBe(200);
    const body = opt.json();
    expect(body.moved).toBe(2);
    const cities = body.route.stops.map((s: { address: { city: string } }) => s.address.city);
    expect(cities).toEqual(["Lisboa", "Porto", "Madrid"]);
  });
});

describe("ETA no tracking público", () => {
  it("estima a chegada a partir da última posição GPS", async () => {
    const sh = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        pickupAddress: { line1: "Rua A 1", city: "Lisboa", postalCode: "1100-001", country: "PT" },
        deliveryAddress: { line1: "Rua B 2", city: "Porto", postalCode: "4000-001", country: "PT" },
      },
    });
    expect(sh.statusCode).toBe(201);
    const shipment = sh.json().shipment;
    await authed(`/api/shipments/${shipment.id}/status`, { method: "POST", payload: { status: "planned" } });
    await authed(`/api/shipments/${shipment.id}/status`, { method: "POST", payload: { status: "in_transit" } });

    // Rota com paragem ligada à expedição + posição GPS do motorista
    const rt = await authed("/api/routes", {
      method: "POST",
      payload: {
        name: "Rota ETA",
        stops: [
          {
            type: "delivery",
            shipmentId: shipment.id,
            address: { line1: "Rua B 2", city: "Porto", postalCode: "4000-001", country: "PT" },
          },
        ],
      },
    });
    const routeId = rt.json().route.id;
    await t.app.db.insert(routePositions).values({
      tenantId,
      routeId,
      lat: 39.5,
      lng: -8.9,
    });
    // Destino com coordenadas (geocoder é noop em testes)
    await t.app.db
      .update(shipments)
      .set({ deliveryLat: 41.15, deliveryLng: -8.61 })
      .where(eq(shipments.id, shipment.id));

    const track = await t.app.inject({ method: "GET", url: `/api/track/${shipment.trackingToken}` });
    expect(track.statusCode).toBe(200);
    const { tracking } = track.json();
    expect(tracking.lastPosition).not.toBeNull();
    expect(tracking.estimatedArrivalAt).not.toBeNull();
    // ~150 km restantes a 50 km/h ≈ 3h — ETA tem de ser no futuro próximo
    const eta = new Date(tracking.estimatedArrivalAt).getTime();
    expect(eta).toBeGreaterThan(Date.now());
    expect(eta).toBeLessThan(Date.now() + 24 * 3_600_000);
  });
});

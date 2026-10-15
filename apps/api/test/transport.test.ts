import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registerTenant, type TestApp } from "./helpers.js";

let t: TestApp;
let token: string;

const authed = (url: string, opts: { method?: string; payload?: unknown } = {}) =>
  t.app.inject({
    method: opts.method ?? "GET",
    url,
    headers: { authorization: `Bearer ${token}` },
    payload: opts.payload as Record<string, unknown> | undefined,
  });

let customerId: string;
let carrierId: string;
let shipmentId: string;
let routeId: string;
let stopId: string;

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  token = res.json().accessToken;

  const c = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["customer"], name: "Cliente T3" },
  });
  customerId = c.json().partner.id;
  const cr = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["carrier"], name: "Carrier T3" },
  });
  carrierId = cr.json().partner.id;
  const s = await authed("/api/shipments", {
    method: "POST",
    payload: {
      customerId,
      carrierId,
      pickupAddress: { line1: "A", city: "Porto", postalCode: "4000", country: "PT" },
      deliveryAddress: { line1: "B", city: "Lisboa", postalCode: "1000", country: "PT" },
    },
  });
  shipmentId = s.json().shipment.id;
});

afterAll(async () => {
  await t.app.close();
});

describe("rotas", () => {
  it("cria rota com paragens e número ROT-", async () => {
    const res = await authed("/api/routes", {
      method: "POST",
      payload: {
        name: "Rota Norte-Sul",
        carrierId,
        driverName: "Motorista A",
        vehicleRef: "00-AA-00",
        stops: [
          {
            type: "pickup",
            shipmentId,
            address: { line1: "Doca 1", city: "Porto", postalCode: "4000", country: "PT" },
          },
          {
            type: "delivery",
            shipmentId,
            address: { line1: "Hub", city: "Lisboa", postalCode: "1000", country: "PT" },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const { route } = res.json();
    expect(route.number).toMatch(/^ROT-\d+$/);
    expect(route.status).toBe("draft");
    expect(route.stopCount).toBe(2);
    expect(route.carrierName).toBe("Carrier T3");
    expect(route.stops[0].shipmentNumber).toMatch(/^EXP-/);
    routeId = route.id;
    stopId = route.stops[1].id;
  });

  it("rejeita rota com expedição de outro contexto inexistente", async () => {
    const res = await authed("/api/routes", {
      method: "POST",
      payload: {
        name: "Rota inválida",
        stops: [
          {
            type: "pickup",
            shipmentId: "00000000-0000-0000-0000-000000000000",
            address: { line1: "x", city: "y", postalCode: "z", country: "PT" },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("despacha rota (draft → dispatched)", async () => {
    const res = await authed(`/api/routes/${routeId}/status`, {
      method: "POST",
      payload: { status: "dispatched" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().route.status).toBe("dispatched");
  });

  it("rejeita transição inválida (dispatched → draft via update)", async () => {
    const res = await authed(`/api/routes/${routeId}/status`, {
      method: "POST",
      payload: { status: "completed" },
    });
    expect(res.statusCode).toBe(200);
    const back = await authed(`/api/routes/${routeId}/status`, {
      method: "POST",
      payload: { status: "dispatched" },
    });
    expect(back.statusCode).toBe(400);
  });

  it("concluir paragem gera checkpoint na expedição", async () => {
    // Cria nova rota para testar paragens (a anterior já está concluída)
    const r = await authed("/api/routes", {
      method: "POST",
      payload: {
        name: "Rota checkpoint",
        stops: [
          {
            type: "delivery",
            shipmentId,
            address: { line1: "Hub", city: "Évora", postalCode: "7000", country: "PT" },
          },
        ],
      },
    });
    const rid = r.json().route.id;
    const sid = r.json().route.stops[0].id;

    const done = await authed(`/api/routes/${rid}/stops/${sid}/status`, {
      method: "POST",
      payload: { status: "done" },
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().stop.status).toBe("done");
    expect(done.json().stop.doneAt).toBeTruthy();

    const detail = await authed(`/api/shipments/${shipmentId}`);
    const events = detail.json().shipment.events;
    const checkpoint = events.find((e: { type: string }) => e.type === "checkpoint");
    expect(checkpoint).toBeTruthy();
    expect(checkpoint.location).toBe("Évora, PT");
    expect(checkpoint.description).toContain("Entrega em Évora");
  });

  it("adiciona paragem a rota existente", async () => {
    const r = await authed("/api/routes", {
      method: "POST",
      payload: { name: "Rota extra" },
    });
    const rid = r.json().route.id;
    const res = await authed(`/api/routes/${rid}/stops`, {
      method: "POST",
      payload: {
        type: "pickup",
        address: { line1: "Armazém", city: "Braga", postalCode: "4700", country: "PT" },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().stop.seq).toBe(1);
    expect(res.json().stop.shipmentNumber).toBeNull();
  });
});

describe("tarifas", () => {
  let rateId: string;

  it("cria tarifa por kg", async () => {
    const res = await authed("/api/rates", {
      method: "POST",
      payload: {
        carrierId,
        name: "Nacional standard",
        basis: "per_kg",
        price: 0.45,
        minCharge: 25,
      },
    });
    expect(res.statusCode).toBe(201);
    const { rate } = res.json();
    expect(rate.carrierName).toBe("Carrier T3");
    expect(rate.basis).toBe("per_kg");
    rateId = rate.id;
  });

  it("rejeita tarifa para parceiro que não é transportadora", async () => {
    const res = await authed("/api/rates", {
      method: "POST",
      payload: { carrierId: customerId, name: "Inválida", basis: "flat", price: 100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("lista tarifas filtradas por transportadora", async () => {
    const res = await authed(`/api/rates?carrierId=${carrierId}`);
    expect(res.json().total).toBe(1);
  });

  it("desativa tarifa", async () => {
    const res = await authed(`/api/rates/${rateId}`, { method: "DELETE" });
    expect(res.json().rate.active).toBe(false);
  });
});

describe("custos de expedição", () => {
  let costId: string;

  it("adiciona custo de frete", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/costs`, {
      method: "POST",
      payload: { type: "freight", description: "Frete Porto-Lisboa", amount: 350 },
    });
    expect(res.statusCode).toBe(201);
    costId = res.json().cost.id;
  });

  it("detalhe devolve custos e total", async () => {
    await authed(`/api/shipments/${shipmentId}/costs`, {
      method: "POST",
      payload: { type: "tolls", description: "Portagens A1", amount: 23.5 },
    });
    const res = await authed(`/api/shipments/${shipmentId}`);
    const { shipment } = res.json();
    expect(shipment.costs).toHaveLength(2);
    expect(shipment.totalCost).toBeCloseTo(373.5);
  });

  it("remove custo", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/costs/${costId}`, {
      method: "DELETE",
    });
    expect(res.statusCode).toBe(200);
    const detail = await authed(`/api/shipments/${shipmentId}`);
    expect(detail.json().shipment.totalCost).toBeCloseTo(23.5);
  });

  it("nota com localização na timeline", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/events`, {
      method: "POST",
      payload: { description: "Checkpoint Coimbra", location: "Coimbra, PT" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().event.location).toBe("Coimbra, PT");
  });
});

describe("isolamento (fase 3)", () => {
  it("tenant B não vê rotas/tarifas/custos do tenant A", async () => {
    const b = await registerTenant(t.app);
    const tokenB = b.res.json().accessToken;
    for (const url of ["/api/routes", "/api/rates"]) {
      const res = await t.app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(res.json().total).toBe(0);
    }
  });
});

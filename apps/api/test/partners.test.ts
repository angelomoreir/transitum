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

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  token = res.json().accessToken;
});
afterAll(async () => {
  await t.app.close();
});

describe("parceiros", () => {
  it("cria cliente com código sequencial CLI-", async () => {
    const res = await authed("/api/partners", {
      method: "POST",
      payload: {
        types: ["customer"],
        name: "Cliente Alfa",
        email: "alfa@cliente.pt",
        city: "Porto",
      },
    });
    expect(res.statusCode).toBe(201);
    const { partner } = res.json();
    expect(partner.code).toMatch(/^CLI-\d+$/);
    expect(partner.types).toEqual(["customer"]);
    expect(partner.active).toBe(true);
  });

  it("cria transportadora com prefixo TRA-", async () => {
    const res = await authed("/api/partners", {
      method: "POST",
      payload: { types: ["carrier"], name: "TransNorte" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().partner.code).toMatch(/^TRA-\d+$/);
  });

  it("lista e filtra por tipo", async () => {
    const all = await authed("/api/partners");
    expect(all.json().total).toBe(2);
    const carriers = await authed("/api/partners?type=carrier");
    expect(carriers.json().total).toBe(1);
    expect(carriers.json().items[0].name).toBe("TransNorte");
  });

  it("pesquisa por nome", async () => {
    const res = await authed("/api/partners?q=alfa");
    expect(res.json().total).toBe(1);
  });

  it("desativa e reativa parceiro (soft delete)", async () => {
    const created = await authed("/api/partners", {
      method: "POST",
      payload: { types: ["supplier"], name: "Fornecedor Beta" },
    });
    const id = created.json().partner.id;
    const off = await authed(`/api/partners/${id}`, { method: "DELETE" });
    expect(off.json().partner.active).toBe(false);
    const on = await authed(`/api/partners/${id}`, { method: "DELETE" });
    expect(on.json().partner.active).toBe(true);
  });

  it("rejeita criação sem tipos", async () => {
    const res = await authed("/api/partners", {
      method: "POST",
      payload: { types: [], name: "Inválido" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("encomendas", () => {
  let customerId: string;
  let orderId: string;

  it("cria encomenda com linhas e número ENC-", async () => {
    const p = await authed("/api/partners", {
      method: "POST",
      payload: { types: ["customer"], name: "Cliente Encomendas" },
    });
    customerId = p.json().partner.id;

    const res = await authed("/api/orders", {
      method: "POST",
      payload: {
        customerId,
        requestedDate: "2026-10-20",
        deliveryCity: "Lisboa",
        lines: [
          { description: "Paletes de componentes", quantity: 5, weightKg: 120 },
          { description: "Caixas diversas", quantity: 20 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const { order } = res.json();
    expect(order.number).toMatch(/^ENC-\d+$/);
    expect(order.status).toBe("draft");
    expect(order.lines).toHaveLength(2);
    orderId = order.id;
  });

  it("rejeita encomenda com parceiro que não é cliente", async () => {
    const c = await authed("/api/partners", {
      method: "POST",
      payload: { types: ["carrier"], name: "Só Transporta" },
    });
    const res = await authed("/api/orders", {
      method: "POST",
      payload: {
        customerId: c.json().partner.id,
        lines: [{ description: "x", quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("confirma encomenda (draft → confirmed)", async () => {
    const res = await authed(`/api/orders/${orderId}`, {
      method: "PATCH",
      payload: { status: "confirmed" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().order.status).toBe("confirmed");
  });

  it("rejeita transição inválida (confirmed → draft)", async () => {
    const res = await authed(`/api/orders/${orderId}`, {
      method: "PATCH",
      payload: { status: "draft" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("detalhe inclui linhas e cliente", async () => {
    const res = await authed(`/api/orders/${orderId}`);
    const { order } = res.json();
    expect(order.customerName).toBe("Cliente Encomendas");
    expect(order.lines).toHaveLength(2);
  });
});

describe("expedições", () => {
  let customerId: string;
  let carrierId: string;
  let shipmentId: string;

  beforeAll(async () => {
    const c = await authed("/api/partners", {
      method: "POST",
      payload: { types: ["customer"], name: "Cliente Exp" },
    });
    customerId = c.json().partner.id;
    const cr = await authed("/api/partners", {
      method: "POST",
      payload: { types: ["carrier"], name: "Carga Expressa" },
    });
    carrierId = cr.json().partner.id;
  });

  it("cria expedição com evento inicial", async () => {
    const res = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        carrierId,
        pickupAddress: { line1: "Rua A 1", city: "Porto", postalCode: "4000-001", country: "PT" },
        deliveryAddress: { line1: "Av B 2", city: "Madrid", postalCode: "28001", country: "ES" },
        plannedDeliveryAt: "2026-10-25T10:00:00Z",
        totalWeightKg: 850,
        packages: 4,
      },
    });
    expect(res.statusCode).toBe(201);
    const { shipment } = res.json();
    expect(shipment.number).toMatch(/^EXP-\d+$/);
    expect(shipment.status).toBe("draft");
    expect(shipment.carrierName).toBe("Carga Expressa");
    expect(shipment.events).toHaveLength(1);
    expect(shipment.events[0].type).toBe("created");
    shipmentId = shipment.id;
  });

  it("rejeita carrierId que não é transportadora", async () => {
    const res = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        carrierId: customerId,
        pickupAddress: { line1: "x", city: "y", postalCode: "z", country: "PT" },
        deliveryAddress: { line1: "x", city: "y", postalCode: "z", country: "PT" },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("percorre ciclo de vida draft → planned → in_transit → delivered", async () => {
    for (const status of ["planned", "in_transit", "delivered"]) {
      const res = await authed(`/api/shipments/${shipmentId}/status`, {
        method: "POST",
        payload: { status },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().shipment.status).toBe(status);
    }
    const detail = await authed(`/api/shipments/${shipmentId}`);
    const events = detail.json().shipment.events;
    expect(events.map((e: { status: string | null }) => e.status)).toEqual([
      "draft",
      "planned",
      "in_transit",
      "delivered",
    ]);
    expect(detail.json().shipment.deliveredAt).toBeTruthy();
  });

  it("rejeita transição inválida (delivered → planned)", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/status`, {
      method: "POST",
      payload: { status: "planned" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("adiciona nota à timeline", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/events`, {
      method: "POST",
      payload: { description: "Cliente confirmou receção por telefone" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().event.type).toBe("note");
  });
});

describe("isolamento (fase 2)", () => {
  it("tenant B não vê parceiros/encomendas do tenant A", async () => {
    const b = await registerTenant(t.app);
    const tokenB = b.res.json().accessToken;
    const res = await t.app.inject({
      method: "GET",
      url: "/api/partners",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.json().total).toBe(0);
    const ord = await t.app.inject({
      method: "GET",
      url: "/api/orders",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(ord.json().total).toBe(0);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, registerTenant, type TestApp } from "./helpers.js";

/**
 * Fase 12 — frota (viaturas + atribuição a rotas), devoluções RMA com entrada
 * em stock, guia de picking (JSON + PDF), torre de controlo (exceções) e
 * contagem física por seleção de artigos.
 */

let t: TestApp;
let token: string;
let customerId: string;
let warehouseId: string;
let itemId: string;
let item2Id: string;
let itemNoStockId: string;

const authed = (url: string, opts: { method?: string; payload?: unknown; bearer?: string } = {}) =>
  t.app.inject({
    method: opts.method ?? "GET",
    url,
    headers: { authorization: `Bearer ${opts.bearer ?? token}` },
    payload: opts.payload as Record<string, unknown> | undefined,
  });

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  token = res.json().accessToken;

  const c = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["customer"], name: "Cliente Fase 12" },
  });
  customerId = c.json().partner.id;

  const wh = await authed("/api/warehouses", {
    method: "POST",
    payload: { name: "Armazém F12" },
  });
  warehouseId = wh.json().warehouse.id;

  const i1 = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F12-001", name: "Artigo doze A", unit: "un" },
  });
  itemId = i1.json().item.id;
  const i2 = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F12-002", name: "Artigo doze B", unit: "un" },
  });
  item2Id = i2.json().item.id;
  const i3 = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F12-003", name: "Artigo sem stock", unit: "un" },
  });
  itemNoStockId = i3.json().item.id;

  await authed("/api/movements", {
    method: "POST",
    payload: { type: "in", itemId, warehouseId, quantity: 30 },
  });
});

afterAll(async () => {
  await t.app.close();
});

describe("frota de viaturas", () => {
  let vehicleId: string;

  it("cria viatura e rejeita matrícula duplicada", async () => {
    const res = await authed("/api/vehicles", {
      method: "POST",
      payload: { plate: "ab-12-cd", name: "Carrinha 1", type: "van", capacityKg: 1200 },
    });
    expect(res.statusCode).toBe(201);
    vehicleId = res.json().vehicle.id;
    expect(res.json().vehicle.plate).toBe("AB-12-CD");

    const dup = await authed("/api/vehicles", {
      method: "POST",
      payload: { plate: "AB-12-CD", name: "Outra", type: "truck" },
    });
    expect(dup.statusCode).toBe(409);
  });

  it("atribui viatura à rota e usa a matrícula como vehicleRef", async () => {
    const res = await authed("/api/routes", {
      method: "POST",
      payload: { name: "Rota com viatura", vehicleId, stops: [] },
    });
    expect(res.statusCode).toBe(201);
    const route = res.json().route;
    expect(route.vehicleId).toBe(vehicleId);
    expect(route.vehicleRef).toBe("AB-12-CD");
    expect(route.vehiclePlate).toBe("AB-12-CD");

    // PATCH para trocar de viatura atualiza a matrícula
    const v2 = await authed("/api/vehicles", {
      method: "POST",
      payload: { plate: "XY-99-ZZ", name: "Camião 2", type: "truck" },
    });
    const patch = await authed(`/api/routes/${route.id}`, {
      method: "PATCH",
      payload: { vehicleId: v2.json().vehicle.id },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().route.vehicleRef).toBe("XY-99-ZZ");
  });

  it("rejeita viatura inativa ou inexistente na rota", async () => {
    await authed(`/api/vehicles/${vehicleId}`, {
      method: "PATCH",
      payload: { active: false },
    });
    const bad = await authed("/api/routes", {
      method: "POST",
      payload: { name: "Rota inválida", vehicleId, stops: [] },
    });
    expect(bad.statusCode).toBe(400);
    const ghost = await authed("/api/routes", {
      method: "POST",
      payload: {
        name: "Rota fantasma",
        vehicleId: "00000000-0000-0000-0000-000000000000",
        stops: [],
      },
    });
    expect(ghost.statusCode).toBe(400);
  });

  it("lista filtrada por ativas", async () => {
    const res = await authed("/api/vehicles?active=true");
    expect(res.statusCode).toBe(200);
    const plates = res.json().items.map((v: { plate: string }) => v.plate);
    expect(plates).toContain("XY-99-ZZ");
    expect(plates).not.toContain("AB-12-CD");
  });
});

describe("devoluções RMA", () => {
  let returnId: string;
  let lineItemQty: number;

  it("cria devolução ligada a cliente + armazém", async () => {
    const res = await authed("/api/returns", {
      method: "POST",
      payload: {
        customerId,
        warehouseId,
        reason: "Artigo danificado",
        lines: [
          { itemId, quantity: 4 },
          { description: "Embalagem manual", quantity: 2 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const ret = res.json().return;
    returnId = ret.id;
    expect(ret.number).toMatch(/^DEV-\d+$/);
    expect(ret.status).toBe("draft");
    lineItemQty = ret.lines[0].quantity;
    expect(lineItemQty).toBe(4);
  });

  it("receção parcial dá entrada em stock e mantém rascunho", async () => {
    const detail = await authed(`/api/returns/${returnId}`);
    const lineId = detail.json().return.lines[0].id;

    const res = await authed(`/api/returns/${returnId}/receive`, {
      method: "POST",
      payload: { lines: [{ lineId, qty: 2 }] },
    });
    expect(res.statusCode).toBe(200);
    const ret = res.json().return;
    expect(ret.status).toBe("draft");
    expect(ret.lines[0].receivedQty).toBe(2);

    // Entraram 2 unidades no armazém
    const stock = await authed(`/api/stock?warehouseId=${warehouseId}&itemId=${itemId}`);
    expect(stock.json().items[0].onHand).toBe(32);
  });

  it("receção total marca a devolução como recebida", async () => {
    const res = await authed(`/api/returns/${returnId}/receive`, { method: "POST", payload: {} });
    expect(res.statusCode).toBe(200);
    const ret = res.json().return;
    expect(ret.status).toBe("received");
    expect(ret.receivedAt).toBeTruthy();
    // Linha sem artigo não mexe no stock; a linha com artigo recebeu o resto (4 total)
    const stock = await authed(`/api/stock?warehouseId=${warehouseId}&itemId=${itemId}`);
    expect(stock.json().items[0].onHand).toBe(34);

    // Não recebe nem anula duas vezes
    const again = await authed(`/api/returns/${returnId}/receive`, { method: "POST", payload: {} });
    expect(again.statusCode).toBe(400);
    const cancel = await authed(`/api/returns/${returnId}/cancel`, { method: "POST" });
    expect(cancel.statusCode).toBe(400);
  });

  it("anular funciona numa devolução pendente", async () => {
    const res = await authed("/api/returns", {
      method: "POST",
      payload: {
        customerId,
        warehouseId,
        lines: [{ itemId, quantity: 1 }],
      },
    });
    const id = res.json().return.id;
    const cancel = await authed(`/api/returns/${id}/cancel`, { method: "POST" });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().return.status).toBe("cancelled");
  });
});

describe("guia de picking", () => {
  let orderId: string;

  beforeAll(async () => {
    const o = await authed("/api/orders", {
      method: "POST",
      payload: {
        customerId,
        warehouseId,
        requestedDate: "2026-12-01",
        lines: [
          { itemId, quantity: 10 },
          { itemId: item2Id, quantity: 3 },
        ],
      },
    });
    orderId = o.json().order.id;
    // Confirmar reserva stock do itemId (10 reservados; item2 sem stock falharia — criar só item1 confirmável?)
  });

  it("JSON lista linhas por expedir com stock disponível", async () => {
    const res = await authed(`/api/orders/${orderId}/picklist`);
    expect(res.statusCode).toBe(200);
    const pl = res.json().pickList;
    expect(pl.warehouseName).toBe("Armazém F12");
    expect(pl.lines).toHaveLength(2);
    const l1 = pl.lines.find((l: { sku: string }) => l.sku === "F12-001");
    expect(l1.toPick).toBe(10);
    // Disponível = em mão − reservado (34 - 0; a encomenda está em rascunho)
    expect(l1.available).toBe(34);
    const l2 = pl.lines.find((l: { sku: string }) => l.sku === "F12-002");
    expect(l2.available).toBe(0);
  });

  it("PDF responde application/pdf", async () => {
    const res = await authed(`/api/orders/${orderId}/picklist.pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.rawPayload.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("linhas expedidas saem da guia", async () => {
    const detail = await authed(`/api/orders/${orderId}`);
    const orderLineId = detail.json().order.lines.find(
      (l: { sku: string | null }) => l.sku === "F12-001",
    ).id;
    // Expedição parcial de 4 un do item1 → toPick passa a 6
    const sh = await authed("/api/shipments", {
      method: "POST",
      payload: {
        orderId,
        customerId,
        pickupAddress: { line1: "Rua A 1", city: "Lisboa", postalCode: "1100-001", country: "PT" },
        deliveryAddress: { line1: "Rua B 2", city: "Porto", postalCode: "4000-001", country: "PT" },
        lines: [{ orderLineId, quantity: 4 }],
      },
    });
    expect(sh.statusCode).toBe(201);
    const res = await authed(`/api/orders/${orderId}/picklist`);
    const l1 = res.json().pickList.lines.find((l: { sku: string }) => l.sku === "F12-001");
    expect(l1.toPick).toBe(6);
  });
});

describe("torre de controlo (exceções)", () => {
  beforeAll(async () => {
    // Expedição em atraso: plannedDeliveryAt no passado e por entregar
    const late = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        pickupAddress: { line1: "Rua A 1", city: "Lisboa", postalCode: "1100-001", country: "PT" },
        deliveryAddress: { line1: "Rua B 2", city: "Porto", postalCode: "4000-001", country: "PT" },
        plannedDeliveryAt: "2020-01-01T10:00:00.000Z",
      },
    });
    const lateId = late.json().shipment.id;
    await authed(`/api/shipments/${lateId}/status`, { method: "POST", payload: { status: "planned" } });

    // Em trânsito sem transportadora
    const nc = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        pickupAddress: { line1: "Rua A 1", city: "Lisboa", postalCode: "1100-001", country: "PT" },
        deliveryAddress: { line1: "Rua B 2", city: "Porto", postalCode: "4000-001", country: "PT" },
      },
    });
    const ncId = nc.json().shipment.id;
    await authed(`/api/shipments/${ncId}/status`, { method: "POST", payload: { status: "planned" } });
    await authed(`/api/shipments/${ncId}/status`, { method: "POST", payload: { status: "in_transit" } });
    // Entregue sem POD (transição manual sem prova)
    await authed(`/api/shipments/${ncId}/status`, { method: "POST", payload: { status: "delivered" } });
  });

  it("agrega atrasos, PODs em falta e expedições sem transportadora", async () => {
    const res = await authed("/api/reports/exceptions");
    expect(res.statusCode).toBe(200);
    const r = res.json().report;
    expect(r.late).toBeGreaterThanOrEqual(1);
    expect(r.missingPod).toBeGreaterThanOrEqual(1);
    const types = r.items.map((x: { type: string }) => x.type);
    expect(types).toContain("late");
    expect(types).toContain("missing_pod");
    // Atrasos (high) vêm primeiro
    expect(r.items[0].severity).toBe("high");
  });
});

describe("contagem por seleção de artigos", () => {
  it("inclui artigos selecionados mesmo sem registo de stock", async () => {
    const res = await authed("/api/inventory-counts", {
      method: "POST",
      payload: { warehouseId, itemIds: [itemId, itemNoStockId] },
    });
    expect(res.statusCode).toBe(201);
    const lines = res.json().count.lines;
    expect(lines).toHaveLength(2);
    const l3 = lines.find((l: { sku: string }) => l.sku === "F12-003");
    expect(l3.expectedQty).toBe(0);
  });

  it("ajuste positivo em artigo sem stock cria a linha de stock", async () => {
    const res = await authed("/api/inventory-counts", {
      method: "POST",
      payload: { warehouseId, itemIds: [itemNoStockId] },
    });
    const countId = res.json().count.id;
    await authed(`/api/inventory-counts/${countId}/lines`, {
      method: "PATCH",
      payload: { lines: [{ itemId: itemNoStockId, countedQty: 5 }] },
    });
    const apply = await authed(`/api/inventory-counts/${countId}/apply`, { method: "POST" });
    expect(apply.statusCode).toBe(200);
    const stock = await authed(`/api/stock?warehouseId=${warehouseId}&itemId=${itemNoStockId}`);
    expect(stock.json().items[0].onHand).toBe(5);
  });

  it("rejeita artigo inexistente na seleção", async () => {
    const res = await authed("/api/inventory-counts", {
      method: "POST",
      payload: {
        warehouseId,
        itemIds: ["00000000-0000-0000-0000-000000000000"],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

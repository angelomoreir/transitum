import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { distanceCache } from "../src/db/schema.js";
import { estimateRoadKm } from "../src/lib/geo.js";
import { routeLeg } from "../src/lib/routing.js";
import { createTestApp, registerTenant, type TestApp } from "./helpers.js";

/**
 * Fase 15 — faturação ao cliente, stock por bin (putaway/bin-to-bin),
 * números de série e matriz de distâncias real (OSRM com cache).
 */

let t: TestApp;
let token: string;
let customerId: string;
let warehouseId: string;
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

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  token = res.json().accessToken;

  const c = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["customer"], name: "Cliente Fase 15" },
  });
  customerId = c.json().partner.id;

  const wh = await authed("/api/warehouses", {
    method: "POST",
    payload: { name: "Armazém F15" },
  });
  warehouseId = wh.json().warehouse.id;

  const i = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F15-001", name: "Artigo quinze", unit: "un" },
  });
  itemId = i.json().item.id;

  const si = await authed("/api/items", {
    method: "POST",
    payload: { sku: "F15-SER", name: "Equipamento serializado", unit: "un", serialized: true },
  });
  serializedItemId = si.json().item.id;

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

describe("faturação ao cliente", () => {
  it("cria fatura manual com linhas e total calculado", async () => {
    const res = await authed("/api/sales-invoices", {
      method: "POST",
      payload: {
        customerId,
        dueDate: "2030-01-31",
        lines: [
          { description: "Transporte Lisboa → Porto", quantity: 2, unitPrice: 150 },
          { description: "Manuseamento", quantity: 1, unitPrice: 35.5 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const inv = res.json().invoice;
    expect(inv.number).toMatch(/^FT-\d{5}$/);
    expect(inv.status).toBe("draft");
    // Fase 16: total inclui IVA (23% por defeito, arredondado por linha) — 335,50 + 77,16
    expect(inv.subtotal).toBe(335.5);
    expect(inv.taxTotal).toBe(77.16);
    expect(inv.total).toBe(412.66);
    expect(inv.lines).toHaveLength(2);
    expect(inv.customerName).toBe("Cliente Fase 15");
  });

  it("rejeita fatura sem linhas nem encomenda", async () => {
    const res = await authed("/api/sales-invoices", {
      method: "POST",
      payload: { customerId },
    });
    expect(res.statusCode).toBe(400);
  });

  it("copia as linhas com preço da encomenda", async () => {
    const order = await authed("/api/orders", {
      method: "POST",
      payload: {
        customerId,
        lines: [
          { description: "Serviço logístico", quantity: 3, unitPrice: 100 },
          { description: "Sem preço", quantity: 1 },
        ],
      },
    });
    expect(order.statusCode).toBe(201);
    const res = await authed("/api/sales-invoices", {
      method: "POST",
      payload: { customerId, orderId: order.json().order.id },
    });
    expect(res.statusCode).toBe(201);
    const inv = res.json().invoice;
    expect(inv.orderNumber).toBe(order.json().order.number);
    expect(inv.total).toBe(369); // 300 × 1,23 (IVA por defeito)
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0].taxRate).toBe(23);
  });

  it("ciclo de vida draft → issued → paid e bloqueia transições inválidas", async () => {
    const res = await authed("/api/sales-invoices", {
      method: "POST",
      payload: { customerId, lines: [{ description: "X", quantity: 1, unitPrice: 10 }] },
    });
    const id = res.json().invoice.id;

    const paidEarly = await authed(`/api/sales-invoices/${id}/status`, {
      method: "POST",
      payload: { status: "paid" },
    });
    expect(paidEarly.statusCode).toBe(400);

    const issued = await authed(`/api/sales-invoices/${id}/status`, {
      method: "POST",
      payload: { status: "issued" },
    });
    expect(issued.json().invoice.status).toBe("issued");

    const paid = await authed(`/api/sales-invoices/${id}/status`, {
      method: "POST",
      payload: { status: "paid" },
    });
    expect(paid.json().invoice.status).toBe("paid");

    const voided = await authed(`/api/sales-invoices/${id}/status`, {
      method: "POST",
      payload: { status: "void" },
    });
    expect(voided.statusCode).toBe(400);
  });

  it("lista faturas e isola por tenant", async () => {
    const list = await authed("/api/sales-invoices");
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBeGreaterThanOrEqual(3);

    const { res: other } = await registerTenant(t.app);
    const otherList = await authed("/api/sales-invoices", { bearer: other.json().accessToken });
    expect(otherList.json().total).toBe(0);
  });
});

describe("stock por bin", () => {
  it("putaway regista o bin na entrada", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: { type: "in", itemId, warehouseId, quantity: 10, locationId: locationA },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().movement.locationCode).toBe("A-01");

    const levels = await authed(`/api/stock/bin-levels?warehouseId=${warehouseId}`);
    const bin = levels.json().items.find((b: { itemId: string }) => b.itemId === itemId);
    expect(bin.locationCode).toBe("A-01");
    expect(bin.onHand).toBe(10);
  });

  it("transferência bin-to-bin move stock sem alterar o total", async () => {
    const res = await authed("/api/stock/bin-transfer", {
      method: "POST",
      payload: {
        itemId,
        warehouseId,
        fromLocationId: locationA,
        toLocationId: locationB,
        quantity: 4,
      },
    });
    expect(res.statusCode).toBe(201);

    const levels = await authed(`/api/stock/bin-levels?warehouseId=${warehouseId}`);
    const a = levels.json().items.find(
      (b: { itemId: string; locationId: string }) => b.itemId === itemId && b.locationId === locationA,
    );
    const b = levels.json().items.find(
      (x: { itemId: string; locationId: string }) => x.itemId === itemId && x.locationId === locationB,
    );
    expect(a.onHand).toBe(6);
    expect(b.onHand).toBe(4);

    // O total por armazém mantém-se
    const stock = await authed(`/api/stock?warehouseId=${warehouseId}&q=F15-001`);
    expect(stock.json().items[0].onHand).toBe(10);
  });

  it("rejeita transferência acima do disponível no bin", async () => {
    const res = await authed("/api/stock/bin-transfer", {
      method: "POST",
      payload: {
        itemId,
        warehouseId,
        fromLocationId: locationB,
        toLocationId: locationA,
        quantity: 99,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("saída com bin indicado consome desse bin", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: { type: "out", itemId, warehouseId, quantity: 2, locationId: locationB },
    });
    expect(res.statusCode).toBe(201);
    const levels = await authed(`/api/stock/bin-levels?warehouseId=${warehouseId}`);
    const b = levels.json().items.find(
      (x: { itemId: string; locationId: string }) => x.itemId === itemId && x.locationId === locationB,
    );
    expect(b.onHand).toBe(2);
  });

  it("rejeita bin de outro armazém", async () => {
    const wh2 = await authed("/api/warehouses", {
      method: "POST",
      payload: { name: "Armazém F15-B" },
    });
    const res = await authed("/api/movements", {
      method: "POST",
      payload: { type: "in", itemId, warehouseId: wh2.json().warehouse.id, quantity: 1, locationId: locationA },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("números de série", () => {
  it("entrada de artigo serializado sem séries falha", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: { type: "in", itemId: serializedItemId, warehouseId, quantity: 2 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("entrada com séries regista-as como in_stock", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: {
        type: "in",
        itemId: serializedItemId,
        warehouseId,
        quantity: 2,
        serials: ["SN-001", "SN-002"],
      },
    });
    expect(res.statusCode).toBe(201);

    const list = await authed(`/api/stock/serials?itemId=${serializedItemId}`);
    expect(list.json().items).toHaveLength(2);
    expect(list.json().items.every((s: { status: string }) => s.status === "in_stock")).toBe(true);
  });

  it("rejeita série duplicada na entrada", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: {
        type: "in",
        itemId: serializedItemId,
        warehouseId,
        quantity: 1,
        serials: ["SN-001"],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("saída com séries marca-as como expedidas", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: {
        type: "out",
        itemId: serializedItemId,
        warehouseId,
        quantity: 1,
        serials: ["SN-001"],
      },
    });
    expect(res.statusCode).toBe(201);

    const list = await authed(`/api/stock/serials?itemId=${serializedItemId}&q=SN-001`);
    expect(list.json().items[0].status).toBe("issued");
  });

  it("rejeita saída de série inexistente", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: {
        type: "out",
        itemId: serializedItemId,
        warehouseId,
        quantity: 1,
        serials: ["SN-999"],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("séries em entrada de compra (receção com serials)", async () => {
    const sup = await authed("/api/partners", {
      method: "POST",
      payload: { types: ["supplier"], name: "Fornecedor F15" },
    });
    const po = await authed("/api/purchase-orders", {
      method: "POST",
      payload: {
        supplierId: sup.json().partner.id,
        warehouseId,
        lines: [{ itemId: serializedItemId, quantity: 1 }],
      },
    });
    expect(po.statusCode).toBe(201);
    const poId = po.json().purchaseOrder.id;
    await authed(`/api/purchase-orders/${poId}/status`, {
      method: "POST",
      payload: { status: "sent" },
    });
    const lineId = po.json().purchaseOrder.lines.find(
      (l: { itemId: string }) => l.itemId === serializedItemId,
    ).id;
    const recv = await authed(`/api/purchase-orders/${poId}/receive`, {
      method: "POST",
      payload: { lines: [{ lineId, quantity: 1, serials: ["SN-PO-1"], locationId: locationA }] },
    });
    expect(recv.statusCode).toBe(200);
    const list = await authed(`/api/stock/serials?itemId=${serializedItemId}&q=SN-PO-1`);
    expect(list.json().items[0].status).toBe("in_stock");
    const bins = await authed(`/api/stock/bin-levels?warehouseId=${warehouseId}&itemId=${serializedItemId}`);
    expect(bins.json().items[0].onHand).toBe(1);
  });
});

describe("matriz de distâncias (OSRM + cache)", () => {
  const lisboa = { lat: 38.7223, lng: -9.1393 };
  const porto = { lat: 41.1579, lng: -8.6291 };

  it("devolve estimativa Haversine sem router (test mode)", async () => {
    const leg = await routeLeg(t.app.db, lisboa, porto);
    expect(leg.routed).toBe(false);
    expect(leg.km).toBeCloseTo(estimateRoadKm(lisboa, porto), 1);
    expect(leg.durationMin).toBeGreaterThan(0);
  });

  it("serve do cache quando a distância está registada", async () => {
    const key = `${lisboa.lat.toFixed(4)},${lisboa.lng.toFixed(4)}>${porto.lat.toFixed(4)},${porto.lng.toFixed(4)}`;
    await t.app.db
      .insert(distanceCache)
      .values({ key, km: 313.4, durationMin: 180 })
      .onConflictDoUpdate({ target: [distanceCache.key], set: { km: 313.4, durationMin: 180 } });
    const leg = await routeLeg(t.app.db, lisboa, porto);
    expect(leg.routed).toBe(true);
    expect(leg.km).toBe(313.4);
    expect(leg.durationMin).toBe(180);
    // Limpa para não afetar outros testes
    await t.app.db.delete(distanceCache).where(eq(distanceCache.key, key));
  });
});

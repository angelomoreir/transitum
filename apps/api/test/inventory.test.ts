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

let warehouseId: string;
let warehouse2Id: string;
let itemId: string;
let item2Id: string;
let supplierId: string;
let poId: string;
let poLineId: string;

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  token = res.json().accessToken;

  const s = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["supplier"], name: "Fornecedor T4" },
  });
  supplierId = s.json().partner.id;
});

afterAll(async () => {
  await t.app.close();
});

describe("armazéns", () => {
  it("cria armazém com código ARM-", async () => {
    const res = await authed("/api/warehouses", {
      method: "POST",
      payload: {
        name: "Armazém Central",
        address: { line1: "Zona Industrial", city: "Porto", postalCode: "4100", country: "PT" },
      },
    });
    expect(res.statusCode).toBe(201);
    const { warehouse } = res.json();
    expect(warehouse.code).toMatch(/^ARM-\d+$/);
    expect(warehouse.address.city).toBe("Porto");
    warehouseId = warehouse.id;
  });

  it("cria segundo armazém para transferências", async () => {
    const res = await authed("/api/warehouses", {
      method: "POST",
      payload: { name: "Loja Norte" },
    });
    expect(res.statusCode).toBe(201);
    warehouse2Id = res.json().warehouse.id;
  });

  it("lista armazéns", async () => {
    const res = await authed("/api/warehouses");
    expect(res.json().total).toBe(2);
  });
});

describe("artigos", () => {
  it("cria artigo", async () => {
    const res = await authed("/api/items", {
      method: "POST",
      payload: { sku: "sku-001", name: "Caixa palete", unit: "un", weightKg: 12 },
    });
    expect(res.statusCode).toBe(201);
    const { item } = res.json();
    expect(item.sku).toBe("SKU-001");
    itemId = item.id;
  });

  it("rejeita SKU duplicado", async () => {
    const res = await authed("/api/items", {
      method: "POST",
      payload: { sku: "SKU-001", name: "Duplicado" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("cria segundo artigo", async () => {
    const res = await authed("/api/items", {
      method: "POST",
      payload: { sku: "PARAF-M8", name: "Parafuso M8" },
    });
    item2Id = res.json().item.id;
  });
});

describe("movimentos de stock", () => {
  it("entrada de stock", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: { type: "in", itemId, warehouseId, quantity: 100, reference: "INICIAL" },
    });
    expect(res.statusCode).toBe(201);
    const stock = await authed(`/api/stock?warehouseId=${warehouseId}`);
    expect(stock.json().items[0].onHand).toBe(100);
  });

  it("saída reduz stock", async () => {
    await authed("/api/movements", {
      method: "POST",
      payload: { type: "out", itemId, warehouseId, quantity: 30 },
    });
    const stock = await authed(`/api/stock?warehouseId=${warehouseId}&itemId=${itemId}`);
    expect(stock.json().items[0].onHand).toBe(70);
  });

  it("rejeita saída acima do stock", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: { type: "out", itemId, warehouseId, quantity: 1000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("ajuste negativo respeitando mínimo zero", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: { type: "adjust", itemId, warehouseId, quantity: -10, note: "Quebra" },
    });
    expect(res.statusCode).toBe(201);
    const fail = await authed("/api/movements", {
      method: "POST",
      payload: { type: "adjust", itemId, warehouseId, quantity: -999 },
    });
    expect(fail.statusCode).toBe(400);
  });

  it("transferência entre armazéns", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: {
        type: "transfer",
        itemId,
        warehouseId,
        toWarehouseId: warehouse2Id,
        quantity: 20,
      },
    });
    expect(res.statusCode).toBe(201);
    const s1 = await authed(`/api/stock?warehouseId=${warehouseId}&itemId=${itemId}`);
    const s2 = await authed(`/api/stock?warehouseId=${warehouse2Id}&itemId=${itemId}`);
    expect(s1.json().items[0].onHand).toBe(40);
    expect(s2.json().items[0].onHand).toBe(20);
  });

  it("lista movimentos com filtros", async () => {
    const res = await authed(`/api/movements?warehouseId=${warehouseId}&type=transfer`);
    expect(res.json().total).toBe(1);
    expect(res.json().items[0].toWarehouseCode).toMatch(/^ARM-/);
  });
});

describe("compras", () => {
  it("cria compra com número PC- e linhas", async () => {
    const res = await authed("/api/purchase-orders", {
      method: "POST",
      payload: {
        supplierId,
        warehouseId,
        lines: [
          { itemId, quantity: 50, unitPrice: 4.5 },
          { itemId: item2Id, quantity: 200 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const { purchaseOrder } = res.json();
    expect(purchaseOrder.number).toMatch(/^PC-\d+$/);
    expect(purchaseOrder.status).toBe("draft");
    expect(purchaseOrder.supplierName).toBe("Fornecedor T4");
    expect(purchaseOrder.totalQty).toBe(250);
    poId = purchaseOrder.id;
    poLineId = purchaseOrder.lines[0].id;
  });

  it("rejeita compra para parceiro que não é fornecedor", async () => {
    const c = await authed("/api/partners", {
      method: "POST",
      payload: { types: ["customer"], name: "Cliente X" },
    });
    const res = await authed("/api/purchase-orders", {
      method: "POST",
      payload: {
        supplierId: c.json().partner.id,
        warehouseId,
        lines: [{ itemId, quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejeita receção antes de enviar ao fornecedor", async () => {
    const res = await authed(`/api/purchase-orders/${poId}/receive`, {
      method: "POST",
      payload: { lines: [{ lineId: poLineId, quantity: 10 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("envia ao fornecedor (draft → sent)", async () => {
    const res = await authed(`/api/purchase-orders/${poId}/status`, {
      method: "POST",
      payload: { status: "sent" },
    });
    expect(res.json().purchaseOrder.status).toBe("sent");
  });

  it("receção parcial → partially_received + stock + movimento", async () => {
    const res = await authed(`/api/purchase-orders/${poId}/receive`, {
      method: "POST",
      payload: { lines: [{ lineId: poLineId, quantity: 20 }] },
    });
    const { purchaseOrder } = res.json();
    expect(purchaseOrder.status).toBe("partially_received");
    expect(purchaseOrder.lines[0].receivedQty).toBe(20);

    const stock = await authed(`/api/stock?warehouseId=${warehouseId}&itemId=${itemId}`);
    expect(stock.json().items[0].onHand).toBe(60); // 40 + 20 recebidos
    const mov = await authed(`/api/movements?type=in`);
    const poMov = mov.json().items.find((m: { reference: string }) => m.reference?.startsWith("PC-"));
    expect(poMov).toBeTruthy();
  });

  it("rejeita receção acima do pendente", async () => {
    const res = await authed(`/api/purchase-orders/${poId}/receive`, {
      method: "POST",
      payload: { lines: [{ lineId: poLineId, quantity: 31 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("receção total → received", async () => {
    const detail = await authed(`/api/purchase-orders/${poId}`);
    const lines = detail.json().purchaseOrder.lines.map((l: { id: string; quantity: number; receivedQty: number }) => ({
      lineId: l.id,
      quantity: l.quantity - l.receivedQty,
    }));
    const res = await authed(`/api/purchase-orders/${poId}/receive`, {
      method: "POST",
      payload: { lines },
    });
    expect(res.json().purchaseOrder.status).toBe("received");
    const stock = await authed(`/api/stock?warehouseId=${warehouseId}&itemId=${item2Id}`);
    expect(stock.json().items[0].onHand).toBe(200);
  });
});

describe("isolamento (fase 4)", () => {
  it("tenant B não vê armazéns/artigos/stock/compras do tenant A", async () => {
    const b = await registerTenant(t.app);
    const tokenB = b.res.json().accessToken;
    for (const url of [
      "/api/warehouses",
      "/api/items",
      "/api/stock",
      "/api/movements",
      "/api/purchase-orders",
    ]) {
      const res = await t.app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(res.json().total).toBe(0);
    }
  });
});

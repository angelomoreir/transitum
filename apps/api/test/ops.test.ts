import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, extractToken, registerTenant, type TestApp } from "./helpers.js";

/**
 * Fase 9 — ponta a ponta: encomenda → reserva de stock → expedição →
 * saída/devolução automática, tarifas, documentos AT, tracking público,
 * app do motorista com prova de entrega, transportadoras e relatórios.
 */

let t: TestApp;
let token: string;
let driverToken: string;
let driverUserId: string;

let customerId: string;
let carrierId: string;
let warehouseId: string;
let itemId: string;
let orderId: string;
let shipmentId: string;
let trackingToken: string;
let routeId: string;
let deliveryStopId: string;

const authed = (url: string, opts: { method?: string; payload?: unknown } = {}, tok?: string) =>
  t.app.inject({
    method: opts.method ?? "GET",
    url,
    headers: { authorization: `Bearer ${tok ?? token}` },
    payload: opts.payload as Record<string, unknown> | undefined,
  });

const stock = async () =>
  (await authed(`/api/stock?warehouseId=${warehouseId}&itemId=${itemId}`)).json().items[0];

// PNG 1×1 válido
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeAll(async () => {
  t = await createTestApp();
  const { res } = await registerTenant(t.app);
  token = res.json().accessToken;

  const c = await authed("/api/partners", {
    method: "POST",
    payload: {
      types: ["customer"],
      name: "Cliente Ops",
      taxId: "509990130",
      addressLine1: "Rua do Cliente 5",
      city: "Lisboa",
      postalCode: "1100-341",
      country: "PT",
    },
  });
  customerId = c.json().partner.id;

  const cr = await authed("/api/partners", {
    method: "POST",
    payload: { types: ["carrier"], name: "Nacex Teste" },
  });
  carrierId = cr.json().partner.id;

  const wh = await authed("/api/warehouses", {
    method: "POST",
    payload: { name: "Armazém Central", address: { line1: "ZIL", city: "Lisboa", postalCode: "1950-000", country: "PT" } },
  });
  warehouseId = wh.json().warehouse.id;

  const it = await authed("/api/items", {
    method: "POST",
    payload: { sku: "ART-001", name: "Caixa de parafusos", unit: "cx", weightKg: 2 },
  });
  itemId = it.json().item.id;

  // Stock inicial: 10 unidades
  await authed("/api/movements", {
    method: "POST",
    payload: { type: "in", itemId, warehouseId, quantity: 10, reference: "seed" },
  });
});

afterAll(async () => {
  await t.app.close();
});

describe("encomenda → stock → expedição", () => {
  it("cria encomenda com linha ligada a artigo", async () => {
    const res = await authed("/api/orders", {
      method: "POST",
      payload: {
        customerId,
        warehouseId,
        lines: [{ itemId, quantity: 4, unitPrice: 12.5 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const { order } = res.json();
    orderId = order.id;
    expect(order.lines[0].sku).toBe("ART-001");
    expect(order.lines[0].unit).toBe("cx");
    expect(order.totalValue).toBe(50);
    expect(order.warehouseId).toBe(warehouseId);
  });

  it("confirmar reserva o stock", async () => {
    const res = await authed(`/api/orders/${orderId}`, {
      method: "PATCH",
      payload: { status: "confirmed" },
    });
    expect(res.statusCode).toBe(200);
    const level = await stock();
    expect(level.onHand).toBe(10);
    expect(level.reserved).toBe(4);
  });

  it("saída manual respeita o stock reservado", async () => {
    const res = await authed("/api/movements", {
      method: "POST",
      payload: { type: "out", itemId, warehouseId, quantity: 8, reference: "manual" },
    });
    expect(res.statusCode).toBe(400); // só 6 disponíveis (10 − 4 reservadas)
  });

  it("expedição a partir da encomenda copia linhas pendentes", async () => {
    const res = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        orderId,
        carrierId,
        pickupAddress: { line1: "ZIL", city: "Lisboa", postalCode: "1950-000", country: "PT" },
        deliveryAddress: { line1: "Rua do Cliente 5", city: "Lisboa", postalCode: "1100-341", country: "PT" },
        recipientName: "Rececionista",
        recipientEmail: "rececao@cliente.pt",
        notifyRecipient: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const { shipment } = res.json();
    shipmentId = shipment.id;
    trackingToken = shipment.trackingToken;
    expect(shipment.lines).toHaveLength(1);
    expect(shipment.lines[0].quantity).toBe(4);
    expect(shipment.lines[0].sku).toBe("ART-001");
    expect(shipment.totalWeightKg).toBe(8); // 4 × 2 kg
    expect(trackingToken).toHaveLength(40);

    const detail = await authed(`/api/orders/${orderId}`);
    expect(detail.json().order.lines[0].shippedQty).toBe(4);
  });

  it("transição para em trânsito consome a reserva e dá saída ao stock", async () => {
    await authed(`/api/shipments/${shipmentId}/status`, {
      method: "POST",
      payload: { status: "planned" },
    });
    const res = await authed(`/api/shipments/${shipmentId}/status`, {
      method: "POST",
      payload: { status: "in_transit" },
    });
    expect(res.statusCode).toBe(200);
    const level = await stock();
    expect(level.onHand).toBe(6);
    expect(level.reserved).toBe(0);

    const detail = await authed(`/api/shipments/${shipmentId}`);
    const ev = detail.json().shipment.events;
    expect(ev.some((e: { type: string }) => e.type === "stock")).toBe(true);
    expect(ev.some((e: { type: string }) => e.type === "notification")).toBe(true);
  });

  it("tracking público mostra estado sem dados internos", async () => {
    const res = await t.app.inject({ method: "GET", url: `/api/track/${trackingToken}` });
    expect(res.statusCode).toBe(200);
    const { tracking } = res.json();
    expect(tracking.number).toMatch(/^EXP-/);
    expect(tracking.status).toBe("in_transit");
    expect(tracking.destination.city).toBe("Lisboa");
    expect(tracking.events.length).toBeGreaterThan(0);
    expect(tracking.events.every((e: { type: string }) => e.type !== "note" && e.type !== "stock")).toBe(true);
    // Não expõe morada completa nem email do destinatário
    expect(JSON.stringify(tracking)).not.toContain("rececao@cliente.pt");
    expect(JSON.stringify(tracking)).not.toContain("Rua do Cliente");
  });

  it("token inválido devolve 404", async () => {
    const res = await t.app.inject({ method: "GET", url: `/api/track/${"f".repeat(40)}` });
    expect(res.statusCode).toBe(404);
  });
});

describe("tarifas e custos automáticos", () => {
  let rateId: string;

  it("cria tarifa por kg", async () => {
    const res = await authed("/api/rates", {
      method: "POST",
      payload: { carrierId, name: "Standard", basis: "per_kg", price: 1.2, minCharge: 15 },
    });
    expect(res.statusCode).toBe(201);
    rateId = res.json().rate.id;
  });

  it("cotação devolve tarifa calculada", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/quotes`);
    expect(res.statusCode).toBe(200);
    const [q] = res.json().quotes;
    expect(q.rateId).toBe(rateId);
    // 8 kg × 1.2 = 9.6 < mínimo 15
    expect(q.amount).toBe(15);
    expect(q.minChargeApplied).toBe(true);
  });

  it("aplica tarifa e regista custo com rateId", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/apply-rate`, {
      method: "POST",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const { cost, quote } = res.json();
    expect(cost.amount).toBe(15);
    expect(cost.rateId).toBe(rateId);
    expect(quote.carrierName).toBe("Nacex Teste");
  });

  it("cancelar expedição em trânsito devolve o stock", async () => {
    // Segunda expedição com as 6 unidades restantes
    const o2 = await authed("/api/orders", {
      method: "POST",
      payload: { customerId, warehouseId, lines: [{ itemId, quantity: 6 }] },
    });
    const oid = o2.json().order.id;
    await authed(`/api/orders/${oid}`, { method: "PATCH", payload: { status: "confirmed" } });
    const s2 = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        orderId: oid,
        pickupAddress: { line1: "ZIL", city: "Lisboa", postalCode: "1950-000", country: "PT" },
        deliveryAddress: { line1: "Rua X", city: "Porto", postalCode: "4000-000", country: "PT" },
      },
    });
    const sid = s2.json().shipment.id;
    await authed(`/api/shipments/${sid}/status`, { method: "POST", payload: { status: "planned" } });
    await authed(`/api/shipments/${sid}/status`, { method: "POST", payload: { status: "in_transit" } });
    let level = await stock();
    expect(level.onHand).toBe(0);

    const res = await authed(`/api/shipments/${sid}/status`, {
      method: "POST",
      payload: { status: "cancelled" },
    });
    expect(res.statusCode).toBe(200);
    level = await stock();
    expect(level.onHand).toBe(6);
    // A encomenda confirmada volta a ter o stock reservado
    expect(level.reserved).toBe(6);
  });
});

describe("documentos de transporte e AT", () => {
  it("configura dados fiscais e AT", async () => {
    const res = await authed("/api/tenant/fiscal", {
      method: "PATCH",
      payload: {
        taxId: "999999990",
        addressLine1: "Zona Industrial de Lisboa, Lote 4",
        city: "Lisboa",
        postalCode: "1950-000",
        country: "PT",
        at: {
          enabled: true,
          environment: "test",
          username: "599999993/37",
          password: "testes123",
          docType: "GT",
          series: "A",
          seriesValidationCode: "ABCD1234",
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const { fiscal } = res.json();
    expect(fiscal.at.enabled).toBe(true);
    expect(fiscal.at.hasPassword).toBe(true);
    expect(fiscal.atClientMode).toBe("mock");
    expect(JSON.stringify(fiscal)).not.toContain("testes123");
  });

  it("emite guia de transporte e comunica à AT (mock)", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/transport-documents`, {
      method: "POST",
      payload: { vehicleRef: "00-AA-00" },
    });
    expect(res.statusCode).toBe(201);
    const { document } = res.json();
    expect(document.number).toBe("GT A/1");
    expect(document.atcud).toBe("ABCD1234-1");
    expect(document.status).toBe("communicated");
    expect(document.atDocCode).toBeTruthy();
    expect(document.environment).toBe("test");
  });

  it("sequência incrementa por série", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/transport-documents`, {
      method: "POST",
      payload: {},
    });
    expect(res.json().document.number).toBe("GT A/2");
  });

  it("PDF da guia de transporte é gerado", async () => {
    const res = await authed(`/api/shipments/${shipmentId}/documents/guide.pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("PDF CMR e etiquetas são gerados", async () => {
    for (const kind of ["cmr", "labels"]) {
      const res = await authed(`/api/shipments/${shipmentId}/documents/${kind}.pdf`);
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.slice(0, 5).toString()).toBe("%PDF-");
    }
  });

  it("documento falha com dados fiscais incompletos", async () => {
    const other = await registerTenant(t.app);
    const tk2 = other.res.json().accessToken;
    const c = await authed("/api/partners", { method: "POST", payload: { types: ["customer"], name: "Cliente Dois" } }, tk2);
    const s = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId: c.json().partner.id,
        pickupAddress: { line1: "A", city: "Porto", postalCode: "4000-000", country: "PT" },
        deliveryAddress: { line1: "B", city: "Lisboa", postalCode: "1100-341", country: "PT" },
      },
    }, tk2);
    const sid = s.json().shipment.id;
    // AT ativa mas sem NIF/morada do emitente → documento marcado como falhado
    await authed("/api/tenant/fiscal", {
      method: "PATCH",
      payload: { at: { enabled: true, environment: "test", username: "u/1", password: "x", docType: "GT", series: "A" } },
    }, tk2);
    const res = await authed(`/api/shipments/${sid}/transport-documents`, { method: "POST", payload: {} }, tk2);
    expect(res.statusCode).toBe(201);
    expect(res.json().document.status).toBe("failed");
    expect(res.json().document.atMessage).toContain("NIF do emitente");
  });
});

describe("app do motorista e prova de entrega", () => {
  it("convida utilizador com função driver", async () => {
    const invite = await authed("/api/users/invite", {
      method: "POST",
      payload: { name: "Motorista Um", email: "driver@teste.pt", role: "driver" },
    });
    expect(invite.statusCode).toBe(201);
    driverUserId = invite.json().user.id;
    const accept = await t.app.inject({
      method: "POST",
      url: "/api/auth/accept-invite",
      payload: { token: extractToken(invite.json().inviteUrl), password: "Password123" },
    });
    expect(accept.statusCode).toBe(200);
    driverToken = accept.json().accessToken;
  });

  it("driver não acede a rotas do backoffice", async () => {
    const res = await authed("/api/routes", {}, driverToken);
    expect(res.statusCode).toBe(403);
  });

  it("rota atribuída ao motorista aparece na app", async () => {
    const res = await authed("/api/routes", {
      method: "POST",
      payload: {
        name: "Distribuição Lisboa",
        driverUserId,
        vehicleRef: "00-AA-00",
        stops: [
          {
            type: "pickup",
            shipmentId,
            address: { line1: "ZIL", city: "Lisboa", postalCode: "1950-000", country: "PT" },
          },
          {
            type: "delivery",
            shipmentId,
            address: { line1: "Rua do Cliente 5", city: "Lisboa", postalCode: "1100-341", country: "PT" },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    routeId = res.json().route.id;
    deliveryStopId = res.json().route.stops[1].id;
    await authed(`/api/routes/${routeId}/status`, { method: "POST", payload: { status: "dispatched" } });

    const list = await authed("/api/driver/routes", {}, driverToken);
    expect(list.statusCode).toBe(200);
    expect(list.json().routes).toHaveLength(1);
    expect(list.json().routes[0].id).toBe(routeId);
  });

  it("motorista envia posição GPS", async () => {
    const res = await authed("/api/driver/location", {
      method: "POST",
      payload: { routeId, lat: 38.72, lng: -9.14, accuracyM: 10 },
    }, driverToken);
    expect(res.statusCode).toBe(201);

    const detail = await authed(`/api/shipments/${shipmentId}`);
    expect(detail.json().shipment.lastPosition.lat).toBeCloseTo(38.72);
  });

  it("regista prova de entrega e conclui a expedição", async () => {
    const res = await authed(`/api/driver/routes/${routeId}/stops/${deliveryStopId}/proof`, {
      method: "POST",
      payload: {
        recipientName: "Joana Silva",
        signaturePngBase64: PNG_1PX,
        note: "Entregue na receção",
        lat: 38.73,
        lng: -9.13,
      },
    }, driverToken);
    expect(res.statusCode).toBe(201);
    const { proof } = res.json();
    expect(proof.signatureDocId).toBeTruthy();
    expect(proof.recipientName).toBe("Joana Silva");

    const detail = await authed(`/api/shipments/${shipmentId}`);
    const s = detail.json().shipment;
    expect(s.status).toBe("delivered");
    expect(s.proofs).toHaveLength(1);
    expect(s.proofs[0].recipientName).toBe("Joana Silva");
  });

  it("tracking público mostra a prova de entrega", async () => {
    const res = await t.app.inject({ method: "GET", url: `/api/track/${trackingToken}` });
    const { tracking } = res.json();
    expect(tracking.status).toBe("delivered");
    expect(tracking.proof.recipientName).toBe("Joana Silva");
    expect(tracking.proof.signed).toBe(true);
    // A posição da POD é a última registada
    expect(tracking.lastPosition.lat).toBeCloseTo(38.73);
  });
});

describe("ligações a transportadoras", () => {
  it("cria ligação Nacex em modo sandbox", async () => {
    const res = await authed("/api/carrier-connections", {
      method: "POST",
      payload: {
        carrierId,
        provider: "nacex",
        mode: "sandbox",
        credentials: { user: "demo", password: "demo" },
        config: { agency: "01", client: "999" },
      },
    });
    expect(res.statusCode).toBe(201);
    const { connection } = res.json();
    expect(connection.provider).toBe("nacex");
    expect(connection.credentialKeys).toContain("user");
    expect(JSON.stringify(connection)).not.toContain("demo");
  });

  it("marca expedição e gera número de tracking", async () => {
    const s = await authed("/api/shipments", {
      method: "POST",
      payload: {
        customerId,
        carrierId,
        pickupAddress: { line1: "ZIL", city: "Lisboa", postalCode: "1950-000", country: "PT" },
        deliveryAddress: { line1: "Rua Y", city: "Porto", postalCode: "4000-000", country: "PT" },
        packages: 2,
      },
    });
    const sid = s.json().shipment.id;
    const res = await authed(`/api/shipments/${sid}/book`, { method: "POST" });
    expect(res.statusCode).toBe(200);
    const { shipment } = res.json();
    expect(shipment.trackingNumber).toMatch(/^\d{4}\/\d{8}$/);
    expect(shipment.carrierProvider).toBe("nacex");
    expect(shipment.carrierBookedAt).toBeTruthy();
  });

  it("sincroniza eventos de tracking do sandbox", async () => {
    const [s] = (await authed("/api/shipments?pageSize=50")).json().items.filter(
      (x: { trackingNumber?: string }) => x.trackingNumber,
    );
    const res = await authed(`/api/shipments/${s.id}/sync-tracking`, { method: "POST" });
    expect(res.statusCode).toBe(200);
    expect(res.json().newEvents).toBeGreaterThanOrEqual(1);
    // Segunda sincronização não duplica eventos
    const res2 = await authed(`/api/shipments/${s.id}/sync-tracking`, { method: "POST" });
    expect(res2.json().newEvents).toBe(0);
  });

  it("push de tracking via API v1", async () => {
    // Cria chave de API
    const key = await authed("/api/integrations/keys", {
      method: "POST",
      payload: { name: "carrier hook" },
    });
    expect(key.statusCode).toBe(201);
    const apiKey = key.json().secret as string;
    expect(apiKey).toMatch(/^bjk_/);
    const [s] = (await authed("/api/shipments?pageSize=50")).json().items.filter(
      (x: { trackingNumber?: string }) => x.trackingNumber,
    );
    const res = await t.app.inject({
      method: "POST",
      url: "/api/v1/carrier-events",
      headers: { "x-api-key": apiKey },
      payload: {
        trackingNumber: s.trackingNumber,
        status: "info",
        description: "Objeto no centro operacional",
        location: "Madrid",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().matched).toBe(true);
  });
});

describe("relatórios", () => {
  it("overview agrega expedições, custos e transportadoras", async () => {
    const res = await authed("/api/reports/overview");
    expect(res.statusCode).toBe(200);
    const { report } = res.json();
    expect(report.shipments.total).toBeGreaterThanOrEqual(3);
    expect(report.shipments.delivered).toBeGreaterThanOrEqual(1);
    expect(report.costs.total).toBeGreaterThan(0);
    expect(report.carriers[0].carrierName).toBe("Nacex Teste");
    expect(report.customers[0].customerName).toBe("Cliente Ops");
    expect(report.routes.proofs).toBe(1);
    expect(report.weekly.length).toBeGreaterThan(0);
  });

  it("CSV de expedições exporta", async () => {
    const res = await authed("/api/reports/shipments.csv");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("EXP-");
    expect(res.body).toContain("Cliente Ops");
  });
});

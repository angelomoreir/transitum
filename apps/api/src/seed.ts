/**
 * Dados de demonstração — OPCIONAL e claramente identificado.
 * Utilização: SEED_DEMO=1 npm run db:seed -w @transitum/api
 *
 * Idempotente: corre as partes em falta sem duplicar as existentes.
 */
import { createDb, runMigrations } from "./db/client.js";
import {
  automationRules,
  items,
  orderLines,
  orders,
  partners,
  salesInvoiceLines,
  salesInvoices,
  shipmentEvents,
  shipmentLines,
  shipments,
  stockLevels,
  tenants,
  users,
  warehouses,
} from "./db/schema.js";
import { createTrialSubscription, ensurePlans } from "./lib/billing.js";
import { seedDefaultRules } from "./lib/notify.js";
import { hashPassword } from "./lib/passwords.js";
import { nextNumber } from "./lib/sequences.js";
import { slugify } from "./lib/tokens.js";
import { eq, sql } from "drizzle-orm";

if (process.env.SEED_DEMO !== "1") {
  console.error("Defina SEED_DEMO=1 para criar dados de demonstração.");
  process.exit(1);
}

const handle = await createDb();
await runMigrations(handle);
const { db } = handle;

const companyName = "[DEMO] Transportes Atlântico";
const adminEmail = "demo@transitum.local";
const demoPassword = "Demo12345!";

// SEED_RESET=1 — remove por completo o tenant demo para repovoar do zero
// (útil para redefinir periodicamente uma instância de demonstração pública).
{
  const [prev] = await db.select().from(users).where(eq(users.email, adminEmail));
  if (process.env.SEED_RESET === "1" && prev) {
    const tid = prev.tenantId;
    const { rows } = await db.execute(
      sql`select table_name from information_schema.columns
          where table_schema = 'public' and column_name = 'tenant_id'`,
    );
    let pending = rows.map((r) => String(r.table_name));
    // FKs sem cascade — vários passes até as dependências ficarem limpas
    for (let pass = 0; pass < 10 && pending.length; pass++) {
      const failed: string[] = [];
      for (const t of pending) {
        try {
          await db.execute(sql.raw(`DELETE FROM "${t}" WHERE tenant_id = '${tid}'`));
        } catch {
          failed.push(t);
        }
      }
      pending = failed;
    }
    if (pending.length) throw new Error(`Não foi possível limpar: ${pending.join(", ")}`);
    await db.delete(tenants).where(eq(tenants.id, tid));
    console.log("Tenant demo anterior removido.");
  }
}

// ── Tenant + utilizadores ────────────────────────────────────────────────────
let [admin] = await db.select().from(users).where(eq(users.email, adminEmail));
let tenantId: string;

if (admin) {
  tenantId = admin.tenantId;
  console.log("Tenant/utilizadores demo já existem — a completar dados em falta.");
} else {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: companyName, slug: slugify(companyName) })
    .returning();
  tenantId = tenant.id;
  [admin] = await db
    .insert(users)
    .values([
      {
        tenantId,
        email: adminEmail,
        name: "Administrador Demo",
        passwordHash: hashPassword(demoPassword),
        role: "admin",
        status: "active",
      },
      {
        tenantId,
        email: "operador@transitum.local",
        name: "Operador Demo",
        passwordHash: hashPassword(demoPassword),
        role: "operator",
        status: "active",
      },
    ])
    .returning();
  console.log(`Tenant demo criado: ${companyName}`);
}

// Dados fiscais do emitente (necessários para guias/faturas AT)
await db
  .update(tenants)
  .set({
    taxId: "509123456",
    addressLine1: "Rua do Cais 20",
    city: "Lisboa",
    postalCode: "1100-341",
    country: "PT",
    updatedAt: new Date(),
  })
  .where(eq(tenants.id, tenantId));

// Subscrição trial + planos + regras de automatização (como no registo)
await ensurePlans(db);
await createTrialSubscription(db, tenantId);
const [rule] = await db
  .select({ id: automationRules.id })
  .from(automationRules)
  .where(eq(automationRules.tenantId, tenantId));
if (!rule) await seedDefaultRules(db, tenantId);

// ── Dados operacionais ───────────────────────────────────────────────────────
const [anyPartner] = await db
  .select({ id: partners.id })
  .from(partners)
  .where(eq(partners.tenantId, tenantId));

if (anyPartner) {
  console.log("Dados operacionais já existem — nada a fazer.");
} else {
  const now = Date.now();
  const day = 86_400_000;
  const iso = (ms: number) => new Date(ms);
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  // Parceiros
  const mkPartner = async (key: string, data: Record<string, unknown>) => {
    const code = await nextNumber(db, tenantId, key);
    const [p] = await db
      .insert(partners)
      .values({ tenantId, code, ...data } as never)
      .returning();
    return p;
  };

  const cli1 = await mkPartner("partner:customer", {
    types: ["customer"], name: "Mercadona Lisboa, Lda", taxId: "502233445",
    email: "compras@mercadona-lisboa.pt", phone: "213456780",
    addressLine1: "Av. Infante D. Henrique 100", city: "Lisboa", postalCode: "1900-264",
  });
  const cli2 = await mkPartner("partner:customer", {
    types: ["customer"], name: "Ferreira & Filhos — Porto", taxId: "501998877",
    email: "logistica@ferreira-filhos.pt", phone: "225678900",
    addressLine1: "Rua das Flores 45", city: "Porto", postalCode: "4050-262",
  });
  const cli3 = await mkPartner("partner:customer", {
    types: ["customer"], name: "Algarve Fresh Supplies", taxId: "508112233",
    email: "encomendas@algarvefresh.pt", phone: "289445566",
    addressLine1: "Zona Industrial Lote 7", city: "Faro", postalCode: "8005-486",
  });
  const for1 = await mkPartner("partner:supplier", {
    types: ["supplier"], name: "Embalagens Norte, SA", taxId: "504556677",
    email: "vendas@embalagens-norte.pt", phone: "252334455",
    addressLine1: "Parque Industrial Maia", city: "Maia", postalCode: "4470-605",
  });
  const tra1 = await mkPartner("partner:carrier", {
    types: ["carrier"], name: "TransRápido — Transportes", taxId: "505667788",
    email: "operacoes@transrapido.pt", phone: "212998877",
    addressLine1: "EN10 Km 12", city: "Vila Franca de Xira", postalCode: "2600-214",
  });

  // Armazém + artigos + stock
  const whCode = await nextNumber(db, tenantId, "warehouse");
  const [wh] = await db
    .insert(warehouses)
    .values({
      tenantId, code: whCode, name: "Armazém Central — Lisboa",
      addressLine1: "Rua do Cais 20", city: "Lisboa", postalCode: "1100-341", country: "PT",
    })
    .returning();

  const [it1, it2, it3, it4] = await db
    .insert(items)
    .values([
      { tenantId, sku: "CX-30", name: "Caixa cartão 30×20×15", unit: "un", weightKg: 0.35 },
      { tenantId, sku: "PAL-EUR", name: "Palete europeia 800×1200", unit: "un", weightKg: 25 },
      { tenantId, sku: "FILM-500", name: "Filme estirável 500mm", unit: "rl", weightKg: 2.6 },
      { tenantId, sku: "KIT-EXP", name: "Kit expedição (etiquetas+fita)", unit: "kit", weightKg: 0.8 },
    ])
    .returning();

  await db.insert(stockLevels).values([
    { tenantId, warehouseId: wh.id, itemId: it1.id, onHand: 2400, reorderPoint: 500 },
    { tenantId, warehouseId: wh.id, itemId: it2.id, onHand: 180, reorderPoint: 40 },
    { tenantId, warehouseId: wh.id, itemId: it3.id, onHand: 95, reorderPoint: 30 },
    { tenantId, warehouseId: wh.id, itemId: it4.id, onHand: 18, reorderPoint: 20 },
  ]);

  // Encomendas
  const mkOrder = async (
    customer: typeof cli1,
    status: "draft" | "confirmed",
    reqDate: string,
    delivery: { line1: string; city: string; zip: string },
    lines: { item: typeof it1; qty: number; price: number; shipped?: number }[],
  ) => {
    const number = await nextNumber(db, tenantId, "order");
    const [o] = await db
      .insert(orders)
      .values({
        tenantId, number, customerId: customer.id, status,
        requestedDate: reqDate, warehouseId: wh.id,
        deliveryLine1: delivery.line1, deliveryCity: delivery.city,
        deliveryPostalCode: delivery.zip, deliveryCountry: "PT",
        createdBy: admin.id,
      })
      .returning();
    await db.insert(orderLines).values(
      lines.map((l, i) => ({
        tenantId, orderId: o.id, lineNo: i + 1, itemId: l.item.id,
        description: l.item.name, quantity: l.qty, weightKg: (l.item.weightKg ?? 1) * l.qty,
        unitPrice: l.price, shippedQty: l.shipped ?? 0,
      })),
    );
    return o;
  };

  const ord1 = await mkOrder(cli1, "confirmed", ymd(now - 6 * day),
    { line1: "Av. Infante D. Henrique 100", city: "Lisboa", zip: "1900-264" },
    [
      { item: it1, qty: 500, price: 0.62, shipped: 500 },
      { item: it3, qty: 30, price: 4.9, shipped: 30 },
    ]);
  const ord2 = await mkOrder(cli2, "confirmed", ymd(now - 2 * day),
    { line1: "Rua das Flores 45", city: "Porto", zip: "4050-262" },
    [
      { item: it2, qty: 20, price: 9.5 },
      { item: it4, qty: 10, price: 3.75 },
    ]);
  await mkOrder(cli3, "draft", ymd(now + 4 * day),
    { line1: "Zona Industrial Lote 7", city: "Faro", zip: "8005-486" },
    [
      { item: it1, qty: 800, price: 0.58 },
      { item: it2, qty: 12, price: 9.5 },
    ]);

  // Expedições (com timeline de eventos)
  const mkShipment = async (data: Record<string, unknown>) => {
    const number = await nextNumber(db, tenantId, "shipment");
    const [s] = await db
      .insert(shipments)
      .values({ tenantId, number, createdBy: admin.id, ...data } as never)
      .returning();
    return s;
  };
  const ev = async (shipmentId: string, status: string, description: string, at: Date, location?: string) =>
    db.insert(shipmentEvents).values({
      tenantId, shipmentId, type: "status", status: status as never,
      description, location, occurredAt: at, createdBy: admin.id,
    });

  const pickup = {
    pickupLine1: "Rua do Cais 20", pickupCity: "Lisboa",
    pickupPostalCode: "1100-341", pickupCountry: "PT",
    pickupLat: 38.7042, pickupLng: -9.1204,
  };

  // 1) entregue
  const sh1 = await mkShipment({
    ...pickup, orderId: ord1.id, customerId: cli1.id, carrierId: tra1.id,
    status: "delivered",
    deliveryLine1: "Av. Infante D. Henrique 100", deliveryCity: "Lisboa",
    deliveryPostalCode: "1900-264", deliveryCountry: "PT",
    deliveryLat: 38.7139, deliveryLng: -9.1012, distanceKm: 3.4,
    plannedPickupAt: iso(now - 5 * day), plannedDeliveryAt: iso(now - 5 * day + 6 * 3_600_000),
    deliveredAt: iso(now - 5 * day + 5 * 3_600_000),
    totalWeightKg: 253, packages: 8, vehicleRef: "12-AB-34",
    stockIssuedAt: iso(now - 5 * day),
    recipientName: "Armazém Mercadona", recipientEmail: "rececao@mercadona-lisboa.pt",
    recipientPhone: "213456781", trackingToken: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
  });
  await db.insert(shipmentLines).values([
    { tenantId, shipmentId: sh1.id, lineNo: 1, itemId: it1.id, description: it1.name, quantity: 500, unit: "un", weightKg: 175, unitPrice: 0.62 },
    { tenantId, shipmentId: sh1.id, lineNo: 2, itemId: it3.id, description: it3.name, quantity: 30, unit: "rl", weightKg: 78, unitPrice: 4.9 },
  ]);
  await ev(sh1.id, "planned", "Expedição planeada", iso(now - 6 * day));
  await ev(sh1.id, "in_transit", "Recolhida — saída do armazém", iso(now - 5 * day), "Lisboa");
  await ev(sh1.id, "delivered", "Entregue ao destinatário", iso(now - 5 * day + 5 * 3_600_000), "Lisboa");

  // 2) em trânsito
  const sh2 = await mkShipment({
    ...pickup, orderId: ord2.id, customerId: cli2.id, carrierId: tra1.id,
    status: "in_transit",
    deliveryLine1: "Rua das Flores 45", deliveryCity: "Porto",
    deliveryPostalCode: "4050-262", deliveryCountry: "PT",
    deliveryLat: 41.1452, deliveryLng: -8.6108, distanceKm: 313,
    plannedPickupAt: iso(now - 1 * day), plannedDeliveryAt: iso(now + 1 * day),
    totalWeightKg: 508, packages: 20, vehicleRef: "56-CD-78",
    stockIssuedAt: iso(now - 1 * day),
    recipientName: "Ferreira & Filhos", recipientEmail: "rececao@ferreira-filhos.pt",
    recipientPhone: "225678901", trackingToken: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
  });
  await db.insert(shipmentLines).values([
    { tenantId, shipmentId: sh2.id, lineNo: 1, itemId: it2.id, description: it2.name, quantity: 20, unit: "un", weightKg: 500, unitPrice: 9.5 },
    { tenantId, shipmentId: sh2.id, lineNo: 2, itemId: it4.id, description: it4.name, quantity: 10, unit: "kit", weightKg: 8, unitPrice: 3.75 },
  ]);
  await ev(sh2.id, "planned", "Expedição planeada", iso(now - 2 * day));
  await ev(sh2.id, "in_transit", "Recolhida — a caminho do Porto", iso(now - 1 * day), "Lisboa");

  // 3) planeada
  const sh3 = await mkShipment({
    ...pickup, customerId: cli3.id, carrierId: tra1.id,
    status: "planned",
    deliveryLine1: "Zona Industrial Lote 7", deliveryCity: "Faro",
    deliveryPostalCode: "8005-486", deliveryCountry: "PT",
    deliveryLat: 37.0194, deliveryLng: -7.9304, distanceKm: 278,
    plannedPickupAt: iso(now + 2 * day), plannedDeliveryAt: iso(now + 3 * day),
    totalWeightKg: 580, packages: 12,
    recipientName: "Algarve Fresh", recipientEmail: "rececao@algarvefresh.pt",
    recipientPhone: "289445567", trackingToken: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
  });
  await db.insert(shipmentLines).values([
    { tenantId, shipmentId: sh3.id, lineNo: 1, itemId: it1.id, description: it1.name, quantity: 800, unit: "un", weightKg: 280, unitPrice: 0.58 },
    { tenantId, shipmentId: sh3.id, lineNo: 2, itemId: it2.id, description: it2.name, quantity: 12, unit: "un", weightKg: 300, unitPrice: 9.5 },
  ]);
  await ev(sh3.id, "planned", "Expedição planeada", iso(now));

  // Fatura de venda em rascunho (FT) ligada à encomenda entregue
  const ftNumber = await nextNumber(db, tenantId, "sales_invoice");
  const ftLines = [
    { description: it1.name, quantity: 500, unitPrice: 0.62, taxRate: 23 },
    { description: it3.name, quantity: 30, unitPrice: 4.9, taxRate: 23 },
  ];
  const subtotal = ftLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const taxTotal = ftLines.reduce((s, l) => s + (l.quantity * l.unitPrice * l.taxRate) / 100, 0);
  const [ft] = await db
    .insert(salesInvoices)
    .values({
      tenantId, number: ftNumber, customerId: cli1.id, orderId: ord1.id,
      status: "draft", issueDate: ymd(now), dueDate: ymd(now + 30 * day),
      subtotal, taxTotal, total: subtotal + taxTotal, createdBy: admin.id,
    })
    .returning();
  await db.insert(salesInvoiceLines).values(
    ftLines.map((l, i) => ({
      tenantId, invoiceId: ft.id, lineNo: i + 1, ...l,
      taxAmount: (l.quantity * l.unitPrice * l.taxRate) / 100,
      lineTotal: l.quantity * l.unitPrice * (1 + l.taxRate / 100),
    })),
  );

  // Nota: for1 fica disponível para compras a fornecedor (PC-)
  void for1;

  console.log("Dados operacionais criados: 5 parceiros, 1 armazém, 4 artigos, 3 encomendas, 3 expedições, 1 fatura FT.");
}

console.log(`Login: ${adminEmail} / ${demoPassword}`);
await handle.close();

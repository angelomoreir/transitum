import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import type { TransportDocType } from "@transitum/shared";
import {
  atSettings,
  items,
  orderLines,
  orders,
  partners,
  shipmentEvents,
  shipmentLines,
  shipments,
  tenants,
  transportDocuments,
} from "../db/schema.js";
import { audit } from "./audit.js";
import { badRequest } from "./errors.js";
import {
  buildAtQr,
  FINAL_CONSUMER_NIF,
  hashChars,
  lisbonDateTime,
  signDocument,
  validateStockMovement,
  type AtAddress,
  type StockMovement,
} from "./at.js";
import { decryptSecret } from "./secrets.js";
import { env } from "../env.js";
import type { ShippingDocData, TransportDocInfo } from "./pdf.js";
import type { Actor } from "./shipment-flow.js";
import { trackingUrl } from "./shipment-flow.js";

type ShipmentRow = typeof shipments.$inferSelect;

const toAddr = (p: { line1: string; city: string; postalCode: string; country: string }): AtAddress => ({
  detail: p.line1,
  city: p.city,
  postalCode: p.postalCode,
  country: p.country,
});

/** Carrega os dados necessários aos PDFs (guia, CMR, etiquetas) de uma expedição. */
export async function loadShippingDocData(
  app: FastifyInstance,
  s: ShipmentRow,
): Promise<ShippingDocData> {
  const [tenant, customer, carrier, lines, order] = await Promise.all([
    app.db.select().from(tenants).where(eq(tenants.id, s.tenantId)).then((r) => r[0]),
    app.db.select().from(partners).where(eq(partners.id, s.customerId)).then((r) => r[0]),
    s.carrierId
      ? app.db.select().from(partners).where(eq(partners.id, s.carrierId)).then((r) => r[0])
      : Promise.resolve(null),
    app.db
      .select({ line: shipmentLines, sku: items.sku, itemUnit: items.unit })
      .from(shipmentLines)
      .leftJoin(items, eq(shipmentLines.itemId, items.id))
      .where(eq(shipmentLines.shipmentId, s.id))
      .orderBy(shipmentLines.lineNo),
    s.orderId
      ? app.db.select().from(orders).where(eq(orders.id, s.orderId)).then((r) => r[0])
      : Promise.resolve(null),
  ]);
  return {
    issuer: {
      name: tenant?.name ?? "",
      taxId: tenant?.taxId ?? null,
      line1: tenant?.addressLine1 ?? null,
      city: tenant?.city ?? null,
      postalCode: tenant?.postalCode ?? null,
      country: tenant?.country ?? null,
    },
    customer: {
      name: customer?.name ?? "",
      taxId: customer?.taxId ?? null,
      line1: customer?.addressLine1 ?? null,
      city: customer?.city ?? null,
      postalCode: customer?.postalCode ?? null,
      country: customer?.country ?? null,
    },
    carrierName: carrier?.name ?? null,
    shipment: {
      number: s.number,
      pickup: {
        line1: s.pickupLine1,
        city: s.pickupCity,
        postalCode: s.pickupPostalCode,
        country: s.pickupCountry,
      },
      delivery: {
        line1: s.deliveryLine1,
        city: s.deliveryCity,
        postalCode: s.deliveryPostalCode,
        country: s.deliveryCountry,
      },
      plannedPickupAt: s.plannedPickupAt ?? null,
      totalWeightKg: s.totalWeightKg ?? null,
      packages: s.packages ?? null,
      incoterm: s.incoterm ?? null,
      notes: s.notes ?? null,
      recipientName: s.recipientName ?? null,
      trackingNumber: s.trackingNumber ?? null,
      orderNumber: order?.number ?? null,
    },
    lines: lines.map(({ line, sku, itemUnit }) => ({
      description: line.description,
      sku: sku ?? null,
      quantity: line.quantity,
      unit: line.unit ?? itemUnit ?? "UN",
      weightKg: line.weightKg ?? null,
    })),
    trackingUrl: trackingUrl(s.trackingToken),
  };
}

/** Dados do documento para o rodapé fiscal do PDF (QR, ATCUD, hash, código AT). */
export function transportDocInfo(
  d: typeof transportDocuments.$inferSelect,
  data: ShippingDocData,
): TransportDocInfo {
  return {
    docType: d.docType as TransportDocType,
    number: d.number,
    atcud: d.atcud,
    movementStartAt: d.movementStartAt,
    vehicleRef: d.vehicleRef ?? null,
    atDocCode: d.atDocCode ?? null,
    hashChars: hashChars(d.hash),
    signed: !!d.hash,
    qr: buildAtQr({
      issuerTaxId: data.issuer.taxId ?? "",
      customerTaxId: data.customer.taxId ?? FINAL_CONSUMER_NIF,
      customerCountry: data.customer.country ?? "PT",
      docType: d.docType,
      date: lisbonDateTime(d.movementStartAt).slice(0, 10),
      documentNumber: d.number,
      atcud: d.atcud,
      hash: d.hash,
    }),
    softwareCert: env.AT_SOFTWARE_CERT_NUMBER,
    environment: d.environment ?? null,
  };
}

/**
 * Emite um documento de transporte (GT/GR) para a expedição: número sequencial
 * por série, ATCUD, assinatura encadeada e comunicação à AT quando configurada.
 */
export async function issueTransportDocument(
  app: FastifyInstance,
  actor: Actor,
  s: ShipmentRow,
  opts: { docType?: TransportDocType; movementStartAt?: Date; vehicleRef?: string; communicate?: boolean },
) {
  const [tenant, settings, customer, data] = await Promise.all([
    app.db.select().from(tenants).where(eq(tenants.id, s.tenantId)).then((r) => r[0]),
    app.db.select().from(atSettings).where(eq(atSettings.tenantId, s.tenantId)).then((r) => r[0]),
    app.db.select().from(partners).where(eq(partners.id, s.customerId)).then((r) => r[0]),
    loadShippingDocData(app, s),
  ]);
  if (!tenant) throw badRequest("Tenant não encontrado");
  if (!customer) throw badRequest("Cliente da expedição não encontrado");

  const docType: TransportDocType = opts.docType ?? (settings?.docType === "GR" ? "GR" : "GT");
  const series = settings?.series ?? "A";
  const movementStartAt = opts.movementStartAt ?? new Date(Date.now() + 5 * 60_000);

  // Sequência por (tenant, tipo, série) — o índice único protege concorrência
  const [{ max }] = await app.db
    .select({ max: sql<number>`coalesce(max(${transportDocuments.seq}), 0)::int` })
    .from(transportDocuments)
    .where(
      and(
        eq(transportDocuments.tenantId, s.tenantId),
        eq(transportDocuments.docType, docType),
        eq(transportDocuments.series, series),
      ),
    );
  const seq = max + 1;
  const number = `${docType} ${series}/${seq}`;
  const atcud = `${settings?.seriesValidationCode ?? "0"}-${seq}`;

  // Assinatura encadeada: hash do documento anterior na mesma série
  const [prev] = await app.db
    .select({ hash: transportDocuments.hash })
    .from(transportDocuments)
    .where(
      and(
        eq(transportDocuments.tenantId, s.tenantId),
        eq(transportDocuments.docType, docType),
        eq(transportDocuments.series, series),
      ),
    )
    .orderBy(desc(transportDocuments.seq))
    .limit(1);
  const movementDate = lisbonDateTime(movementStartAt).slice(0, 10);
  const sig = signDocument({
    movementDate,
    systemEntryDate: new Date(),
    documentNumber: number,
    previousHash: prev?.hash ?? null,
  });

  // Comunicação à AT (se ativa e credenciada)
  let status: "issued" | "communicated" | "failed" = "issued";
  let atDocCode: string | null = null;
  let atMessage: string | null = null;
  const environment = settings?.environment ?? null;
  const wantAt = (opts.communicate ?? true) && settings?.enabled;
  if (wantAt) {
    if (!settings?.username || !settings.passwordEnc) {
      status = "failed";
      atMessage = "Credenciais da AT em falta (utilizador/palavra-passe)";
    } else {
      const doc: StockMovement = {
        taxId: tenant.taxId ?? "",
        companyName: tenant.name,
        companyAddress: toAddr({
          line1: tenant.addressLine1 ?? "",
          city: tenant.city ?? "",
          postalCode: tenant.postalCode ?? "",
          country: tenant.country ?? "PT",
        }),
        documentNumber: number,
        atcud,
        movementDate,
        movementType: docType,
        customerTaxId: customer.taxId ?? FINAL_CONSUMER_NIF,
        customerName: customer.name,
        customerAddress: toAddr({
          line1: customer.addressLine1 ?? "",
          city: customer.city ?? "",
          postalCode: customer.postalCode ?? "",
          country: customer.country ?? "PT",
        }),
        addressTo: toAddr({
          line1: s.deliveryLine1,
          city: s.deliveryCity,
          postalCode: s.deliveryPostalCode,
          country: s.deliveryCountry,
        }),
        addressFrom: toAddr({
          line1: s.pickupLine1,
          city: s.pickupCity,
          postalCode: s.pickupPostalCode,
          country: s.pickupCountry,
        }),
        movementStartTime: movementStartAt,
        vehicleId: opts.vehicleRef ?? s.vehicleRef,
        lines: data.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: 0,
        })),
      };
      const errors = validateStockMovement(doc);
      if (errors.length) {
        status = "failed";
        atMessage = errors.join("; ").slice(0, 500);
      } else {
        const result = await app.atClient.communicate(settings.environment as "test" | "production", {
          username: settings.username,
          password: decryptSecret(settings.passwordEnc),
        }, doc);
        if (result.ok) {
          status = "communicated";
          atDocCode = result.atDocCode;
          atMessage = result.message;
        } else {
          status = "failed";
          atMessage = `${result.code}: ${result.message}`.slice(0, 500);
        }
      }
    }
  }

  const [doc] = await app.db
    .insert(transportDocuments)
    .values({
      tenantId: s.tenantId,
      shipmentId: s.id,
      docType,
      series,
      seq,
      number,
      atcud,
      movementStartAt,
      vehicleRef: opts.vehicleRef ?? s.vehicleRef ?? null,
      hash: sig?.hash ?? null,
      hashControl: sig?.hashControl ?? null,
      status,
      environment: wantAt ? environment : null,
      atDocCode,
      atMessage,
      communicatedAt: status === "communicated" ? new Date() : null,
      createdBy: actor.userId,
    })
    .returning();
  await app.db.insert(shipmentEvents).values({
    tenantId: s.tenantId,
    shipmentId: s.id,
    type: "document",
    description:
      status === "communicated"
        ? `${docType} ${number} emitido e comunicado à AT (código ${atDocCode})`
        : status === "failed"
          ? `${docType} ${number} emitido — comunicação à AT falhou: ${atMessage}`
          : `${docType} ${number} emitido`,
    createdBy: actor.userId,
  });
  await audit(app.db, {
    tenantId: actor.tenantId,
    actorId: actor.userId,
    action: "transport_documents.issued",
    entity: "transport_document",
    entityId: doc.id,
    metadata: { shipmentId: s.id, number, status },
    ip: actor.ip,
  });
  return doc;
}

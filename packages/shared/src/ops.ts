import { z } from "zod";
import { coordsSchema, positionDtoSchema, shipmentStatusSchema, TRANSPORT_DOC_TYPES } from "./shipments.js";
import { stopStatusSchema, stopTypeSchema } from "./routes.js";

// ── Dados fiscais e comunicação AT ──────────────────────────────────────────

export const AT_ENVIRONMENTS = ["test", "production"] as const;

/** NIF português: 9 dígitos com dígito de controlo módulo 11. */
export function isValidPtNif(nif: string): boolean {
  if (!/^\d{9}$/.test(nif)) return false;
  const digits = nif.split("").map(Number);
  const sum = digits.slice(0, 8).reduce((acc, d, i) => acc + d * (9 - i), 0);
  const check = 11 - (sum % 11);
  return (check >= 10 ? 0 : check) === digits[8];
}

export const fiscalSettingsUpdateSchema = z
  .object({
    taxId: z.string().trim().max(32).optional(),
    addressLine1: z.string().trim().max(160).optional(),
    city: z.string().trim().max(80).optional(),
    postalCode: z.string().trim().max(16).optional(),
    country: z.string().trim().length(2).toUpperCase().optional(),
    at: z
      .object({
        enabled: z.boolean(),
        environment: z.enum(AT_ENVIRONMENTS),
        username: z.string().trim().max(40).optional(),
        /** Write-only: omitido mantém a palavra-passe atual */
        password: z.string().min(1).max(100).optional(),
        docType: z.enum(TRANSPORT_DOC_TYPES),
        series: z
          .string()
          .trim()
          .min(1)
          .max(20)
          .regex(/^[A-Za-z0-9_.-]+$/, "Série só pode conter letras, números, _ . -"),
        seriesValidationCode: z.string().trim().max(20).optional(),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.taxId && (v.country ?? "PT") === "PT" && !isValidPtNif(v.taxId)) {
      ctx.addIssue({ code: "custom", message: "NIF inválido", path: ["taxId"] });
    }
  });
export type FiscalSettingsUpdateInput = z.infer<typeof fiscalSettingsUpdateSchema>;

export const fiscalSettingsDtoSchema = z.object({
  taxId: z.string().nullable(),
  addressLine1: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
  at: z.object({
    enabled: z.boolean(),
    environment: z.enum(AT_ENVIRONMENTS),
    username: z.string().nullable(),
    hasPassword: z.boolean(),
    docType: z.enum(TRANSPORT_DOC_TYPES),
    series: z.string(),
    seriesValidationCode: z.string().nullable(),
  }),
  /** Modo do cliente AT no servidor: "mock" (simulado) ou "live" */
  atClientMode: z.enum(["mock", "live"]),
  /** Assinatura de documentos configurada no servidor (chave privada) */
  signingConfigured: z.boolean(),
});
export type FiscalSettingsDto = z.infer<typeof fiscalSettingsDtoSchema>;

export const transportDocumentCreateSchema = z.object({
  docType: z.enum(TRANSPORT_DOC_TYPES).optional(),
  /** Início do transporte (ISO). Omitido → agora + 5 minutos */
  movementStartAt: z.string().optional(),
  vehicleRef: z.string().trim().max(40).optional(),
});
export type TransportDocumentCreateInput = z.infer<typeof transportDocumentCreateSchema>;

// ── Tracking público ────────────────────────────────────────────────────────

export const publicTrackingDtoSchema = z.object({
  companyName: z.string(),
  number: z.string(),
  status: shipmentStatusSchema,
  carrierName: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  origin: z.object({ city: z.string(), country: z.string() }),
  destination: z.object({ city: z.string(), country: z.string() }),
  destinationCoords: coordsSchema.nullable(),
  plannedDeliveryAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  /** ETA estimado a partir da última posição GPS (nulo sem posição/coords) */
  estimatedArrivalAt: z.string().nullable(),
  lastPosition: positionDtoSchema.nullable(),
  events: z.array(
    z.object({
      type: z.string(),
      status: z.string().nullable(),
      description: z.string(),
      location: z.string().nullable(),
      occurredAt: z.string(),
    }),
  ),
  proof: z
    .object({ recipientName: z.string(), capturedAt: z.string(), signed: z.boolean() })
    .nullable(),
});
export type PublicTrackingDto = z.infer<typeof publicTrackingDtoSchema>;

// ── App do motorista ────────────────────────────────────────────────────────

export const driverStopDtoSchema = z.object({
  id: z.string(),
  seq: z.number(),
  type: stopTypeSchema,
  status: stopStatusSchema,
  address: z.object({
    line1: z.string(),
    city: z.string(),
    postalCode: z.string(),
    country: z.string(),
  }),
  coords: coordsSchema.nullable(),
  plannedAt: z.string().nullable(),
  note: z.string().nullable(),
  shipment: z
    .object({
      id: z.string(),
      number: z.string(),
      customerName: z.string(),
      recipientName: z.string().nullable(),
      recipientPhone: z.string().nullable(),
      packages: z.number().nullable(),
      totalWeightKg: z.number().nullable(),
      status: shipmentStatusSchema,
    })
    .nullable(),
  hasProof: z.boolean(),
});
export type DriverStopDto = z.infer<typeof driverStopDtoSchema>;

export const driverRouteDtoSchema = z.object({
  id: z.string(),
  number: z.string(),
  name: z.string(),
  status: z.enum(["draft", "dispatched", "completed", "cancelled"]),
  vehicleRef: z.string().nullable(),
  plannedStartAt: z.string().nullable(),
  stopCount: z.number(),
  doneStops: z.number(),
});
export type DriverRouteDto = z.infer<typeof driverRouteDtoSchema>;

export const driverRouteDetailDtoSchema = driverRouteDtoSchema.extend({
  stops: z.array(driverStopDtoSchema),
});
export type DriverRouteDetailDto = z.infer<typeof driverRouteDetailDtoSchema>;

export const driverStopStatusSchema = z.object({
  status: z.enum(["arrived", "done", "skipped"]),
  note: z.string().trim().max(300).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export type DriverStopStatusInput = z.infer<typeof driverStopStatusSchema>;

/** Imagens até ~2 MB em base64 (PNG da assinatura, JPEG da foto). */
const imageBase64 = z
  .string()
  .min(16)
  .refine((s) => Math.floor((s.length * 3) / 4) <= 2 * 1024 * 1024, {
    message: "Imagem excede 2 MB",
  });

export const podCreateSchema = z.object({
  recipientName: z.string().trim().min(2).max(120),
  signaturePngBase64: imageBase64,
  photoJpegBase64: imageBase64.optional(),
  note: z.string().trim().max(300).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export type PodCreateInput = z.infer<typeof podCreateSchema>;

export const driverLocationSchema = z.object({
  routeId: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000).optional(),
});
export type DriverLocationInput = z.infer<typeof driverLocationSchema>;

// ── Transportadoras (CTT, DPD, Nacex) ───────────────────────────────────────

export const CARRIER_PROVIDERS = ["ctt", "dpd", "nacex"] as const;
export type CarrierProvider = (typeof CARRIER_PROVIDERS)[number];
export const CARRIER_MODES = ["sandbox", "live"] as const;

export const carrierConnectionCreateSchema = z.object({
  carrierId: z.string().uuid(),
  provider: z.enum(CARRIER_PROVIDERS),
  mode: z.enum(CARRIER_MODES).default("sandbox"),
  /** Segredos (utilizador, palavra-passe, chave API) — guardados cifrados */
  credentials: z.record(z.string().max(200)).default({}),
  /** Configuração não secreta (agência, nº de cliente, serviço…) */
  config: z.record(z.string().max(200)).default({}),
});
export type CarrierConnectionCreateInput = z.infer<typeof carrierConnectionCreateSchema>;

export const carrierConnectionDtoSchema = z.object({
  id: z.string(),
  carrierId: z.string(),
  carrierName: z.string(),
  provider: z.enum(CARRIER_PROVIDERS),
  mode: z.enum(CARRIER_MODES),
  config: z.record(z.string()),
  credentialKeys: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.string(),
});
export type CarrierConnectionDto = z.infer<typeof carrierConnectionDtoSchema>;

/** Evento de tracking enviado por transportadora/agregador (API v1). */
export const carrierEventSchema = z.object({
  trackingNumber: z.string().trim().min(3).max(60),
  status: z.enum(["in_transit", "out_for_delivery", "delivered", "exception", "info"]),
  description: z.string().trim().min(1).max(300),
  location: z.string().trim().max(160).optional(),
  occurredAt: z.string().datetime().optional(),
});
export type CarrierEventInput = z.infer<typeof carrierEventSchema>;

// ---- Intake EDI / e-commerce (API v1) ----

/** Linha de encomenda externa: artigo por SKU ou texto livre */
export const inboundOrderLineSchema = z
  .object({
    sku: z.string().trim().max(60).optional(),
    description: z.string().trim().max(200).optional(),
    quantity: z.coerce.number().int().min(1).default(1),
    unitPrice: z.coerce.number().min(0).optional(),
  })
  .refine((l) => !!l.sku || !!l.description, {
    message: "Cada linha precisa de SKU ou descrição",
    path: ["description"],
  });
export type InboundOrderLineInput = z.infer<typeof inboundOrderLineSchema>;

/**
 * Encomenda recebida de um sistema externo (ERP/loja/EDI).
 * `externalRef` é idempotente — repetir o envio devolve a encomenda existente.
 */
export const inboundOrderSchema = z.object({
  externalRef: z.string().trim().min(1).max(80),
  customer: z.object({
    name: z.string().trim().min(2).max(160),
    taxId: z.string().trim().max(32).optional(),
    email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().max(32).optional(),
  }),
  /** Armazém de saída pelo código; omitido → armazém ativo por defeito */
  warehouseCode: z.string().trim().max(24).optional(),
  requestedDate: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
  deliveryLine1: z.string().trim().max(160).optional(),
  deliveryCity: z.string().trim().max(80).optional(),
  deliveryPostalCode: z.string().trim().max(16).optional(),
  deliveryCountry: z.string().trim().length(2).toUpperCase().optional(),
  lines: z.array(inboundOrderLineSchema).min(1, "Precisa de pelo menos uma linha"),
});
export type InboundOrderInput = z.infer<typeof inboundOrderSchema>;

export const inboundOrderResponseSchema = z.object({
  order: z.object({
    id: z.string(),
    number: z.string(),
    status: z.string(),
    externalRef: z.string().nullable(),
  }),
  /** true quando já existia com a mesma externalRef (idempotência) */
  duplicate: z.boolean(),
});
export type InboundOrderResponse = z.infer<typeof inboundOrderResponseSchema>;

// ---- Portal do cliente (link público) ----

export const portalOrderDtoSchema = z.object({
  number: z.string(),
  status: z.string(),
  requestedDate: z.string().nullable(),
  createdAt: z.string(),
  lines: z.number(),
});
export type PortalOrderDto = z.infer<typeof portalOrderDtoSchema>;

export const portalShipmentDtoSchema = z.object({
  number: z.string(),
  status: z.string(),
  orderNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
});
export type PortalShipmentDto = z.infer<typeof portalShipmentDtoSchema>;

export const portalDtoSchema = z.object({
  customerName: z.string(),
  orders: z.array(portalOrderDtoSchema),
  shipments: z.array(portalShipmentDtoSchema),
});
export type PortalDto = z.infer<typeof portalDtoSchema>;

/** Encomenda criada pelo próprio cliente no portal público. */
export const portalOrderCreateSchema = z.object({
  requestedDate: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
  deliveryLine1: z.string().trim().max(160).optional(),
  deliveryCity: z.string().trim().max(80).optional(),
  deliveryPostalCode: z.string().trim().max(16).optional(),
  deliveryCountry: z.string().trim().length(2).toUpperCase().optional(),
  lines: z
    .array(
      z.object({
        sku: z.string().trim().max(60).optional(),
        description: z.string().trim().max(200).optional(),
        quantity: z.coerce.number().int().min(1).default(1),
        unitPrice: z.coerce.number().min(0).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type PortalOrderCreateInput = z.infer<typeof portalOrderCreateSchema>;

// ---- Canais de entrada (webhooks Shopify/WooCommerce/genérico) ----

export const WEBHOOK_SOURCES = ["shopify", "woocommerce", "generic", "edifact"] as const;
export type WebhookSource = (typeof WEBHOOK_SOURCES)[number];

export const inboundChannelCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  source: z.enum(WEBHOOK_SOURCES),
  /** Segredo HMAC usado para validar a assinatura do remetente */
  secret: z.string().min(8).max(200),
});
export type InboundChannelCreateInput = z.infer<typeof inboundChannelCreateSchema>;

export const inboundChannelDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.enum(WEBHOOK_SOURCES),
  /** URL de entrada a configurar no sistema externo */
  token: z.string(),
  url: z.string(),
  active: z.boolean(),
  lastReceivedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type InboundChannelDto = z.infer<typeof inboundChannelDtoSchema>;

// ---- Wave picking (guia agregada multi-encomenda) ----

export const pickWaveCreateSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(50),
});
export type PickWaveCreateInput = z.infer<typeof pickWaveCreateSchema>;

export const pickWaveLineDtoSchema = z.object({
  sku: z.string().nullable(),
  itemName: z.string(),
  itemId: z.string().nullable(),
  unit: z.string().nullable(),
  location: z.string().nullable(),
  toPick: z.number(),
  available: z.number().nullable(),
  /** Quantidade por encomenda */
  orders: z.array(z.object({ orderNumber: z.string(), qty: z.number() })),
});
export type PickWaveLineDto = z.infer<typeof pickWaveLineDtoSchema>;

export const pickWaveDtoSchema = z.object({
  orders: z.array(
    z.object({ id: z.string(), number: z.string(), customerName: z.string() }),
  ),
  warehouseName: z.string().nullable(),
  lines: z.array(pickWaveLineDtoSchema),
});
export type PickWaveDto = z.infer<typeof pickWaveDtoSchema>;

// ---- Waves de picking persistidas (atribuição a operador e progresso) ----

export const PICK_WAVE_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type PickWaveStatus = (typeof PICK_WAVE_STATUSES)[number];
export const pickWaveStatusSchema = z.enum(PICK_WAVE_STATUSES);

export const PICK_WAVE_TRANSITIONS: Record<PickWaveStatus, PickWaveStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

/** Cria uma wave persistida a partir das linhas por expedir das encomendas. */
export const pickWaveRecordCreateSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(50),
  /** Utilizador (operador) a quem a wave fica atribuída */
  assignedTo: z.string().uuid().optional(),
});
export type PickWaveRecordCreateInput = z.infer<typeof pickWaveRecordCreateSchema>;

export const pickWaveRecordUpdateSchema = z.object({
  status: z.enum(["in_progress", "done", "cancelled"]).optional(),
  /** null remove a atribuição */
  assignedTo: z.string().uuid().nullable().optional(),
});
export type PickWaveRecordUpdateInput = z.infer<typeof pickWaveRecordUpdateSchema>;

/** Registo de picking por linha — pickedQty <= quantity. */
export const pickWaveLinesUpdateSchema = z.object({
  lines: z
    .array(
      z.object({
        id: z.string().uuid(),
        pickedQty: z.coerce.number().int().min(0),
      }),
    )
    .min(1)
    .max(500),
});
export type PickWaveLinesUpdateInput = z.infer<typeof pickWaveLinesUpdateSchema>;

export const pickWaveRecordLineDtoSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  orderNumber: z.string(),
  orderLineId: z.string(),
  itemId: z.string().nullable(),
  sku: z.string().nullable(),
  itemName: z.string(),
  /** Localização preferencial de picking (zona-código) no momento da criação */
  location: z.string().nullable(),
  quantity: z.number(),
  pickedQty: z.number(),
  pickedAt: z.string().nullable(),
});
export type PickWaveRecordLineDto = z.infer<typeof pickWaveRecordLineDtoSchema>;

export const pickWaveRecordDtoSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: pickWaveStatusSchema,
  assignedTo: z.string().nullable(),
  assignedToName: z.string().nullable(),
  warehouseName: z.string().nullable(),
  lineCount: z.number(),
  pickedCount: z.number(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type PickWaveRecordDto = z.infer<typeof pickWaveRecordDtoSchema>;

export const pickWaveRecordDetailDtoSchema = pickWaveRecordDtoSchema.extend({
  lines: z.array(pickWaveRecordLineDtoSchema),
});
export type PickWaveRecordDetailDto = z.infer<typeof pickWaveRecordDetailDtoSchema>;

export const listPickWavesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: pickWaveStatusSchema.optional(),
  assignedTo: z.string().uuid().optional(),
});

// ── Relatórios ──────────────────────────────────────────────────────────────

export const reportsQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const reportOverviewDtoSchema = z.object({
  from: z.string(),
  to: z.string(),
  shipments: z.object({
    total: z.number(),
    byStatus: z.record(z.number()),
    delivered: z.number(),
    deliveredWithPlan: z.number(),
    onTime: z.number(),
    /** 0–1, null se não houver entregas com data planeada */
    onTimeRate: z.number().nullable(),
    avgTransitHours: z.number().nullable(),
    /** Emissões estimadas (kg CO₂e) somadas no período */
    estimatedCo2Kg: z.number(),
  }),
  costs: z.object({
    total: z.number(),
    perShipment: z.number().nullable(),
    perKg: z.number().nullable(),
    totalWeightKg: z.number(),
    byType: z.record(z.number()),
  }),
  carriers: z.array(
    z.object({
      carrierId: z.string(),
      carrierName: z.string(),
      shipments: z.number(),
      delivered: z.number(),
      onTimeRate: z.number().nullable(),
      /** 0–1, provas de entrega / entregas na rota desta transportadora; null sem PODs esperados */
      podRate: z.number().nullable(),
      totalCost: z.number(),
      avgCost: z.number().nullable(),
      /** Faturas de frete auditadas no período */
      invoices: z.number(),
      /** Faturas com discrepância de valor vs custo esperado */
      invoiceDiscrepancies: z.number(),
    }),
  ),
  customers: z.array(
    z.object({ customerId: z.string(), customerName: z.string(), shipments: z.number() }),
  ),
  weekly: z.array(
    z.object({ week: z.string(), created: z.number(), delivered: z.number(), cost: z.number() }),
  ),
  routes: z.object({
    completed: z.number(),
    stopsDone: z.number(),
    stopsSkipped: z.number(),
    proofs: z.number(),
  }),
});
export type ReportOverviewDto = z.infer<typeof reportOverviewDtoSchema>;

// ---- Torre de controlo: exceções operacionais ----

export const EXCEPTION_TYPES = ["late", "missing_pod", "no_carrier"] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

export const exceptionDtoSchema = z.object({
  type: z.enum(EXCEPTION_TYPES),
  /** Gravidade: high = SLA já falhado; medium = risco/incompleto */
  severity: z.enum(["high", "medium"]),
  shipmentId: z.string(),
  shipmentNumber: z.string(),
  customerName: z.string(),
  message: z.string(),
  /** Momento relevante da exceção (ex.: data prevista falhada) */
  since: z.string().nullable(),
});
export type ExceptionDto = z.infer<typeof exceptionDtoSchema>;

export const exceptionsReportSchema = z.object({
  late: z.number(),
  missingPod: z.number(),
  noCarrier: z.number(),
  items: z.array(exceptionDtoSchema),
});
export type ExceptionsReport = z.infer<typeof exceptionsReportSchema>;

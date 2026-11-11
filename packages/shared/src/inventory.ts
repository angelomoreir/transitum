import { z } from "zod";
import { addressSchema } from "./shipments.js";

// ── Armazéns ────────────────────────────────────────────────────────────────

export const warehouseCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  address: addressSchema.optional(),
});
export type WarehouseCreateInput = z.infer<typeof warehouseCreateSchema>;

export const warehouseUpdateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  address: addressSchema.nullish(),
  active: z.boolean().optional(),
});
export type WarehouseUpdateInput = z.infer<typeof warehouseUpdateSchema>;

export const warehouseDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  code: z.string(),
  name: z.string(),
  address: addressSchema.nullable(),
  active: z.boolean(),
  itemCount: z.number(),
  createdAt: z.string(),
});
export type WarehouseDto = z.infer<typeof warehouseDtoSchema>;

export const listWarehousesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  active: z.enum(["true", "false"]).optional(),
});

// ── Localizações (bins/zonas) ──────────────────────────────────────────────

export const warehouseLocationCreateSchema = z.object({
  code: z.string().trim().min(1).max(24).toUpperCase(),
  zone: z.string().trim().max(40).optional(),
});
export type WarehouseLocationCreateInput = z.infer<typeof warehouseLocationCreateSchema>;

export const warehouseLocationUpdateSchema = z.object({
  zone: z.string().trim().max(40).nullish(),
  active: z.boolean().optional(),
});
export type WarehouseLocationUpdateInput = z.infer<typeof warehouseLocationUpdateSchema>;

export const warehouseLocationDtoSchema = z.object({
  id: z.string(),
  warehouseId: z.string(),
  code: z.string(),
  zone: z.string().nullable(),
  active: z.boolean(),
  itemCount: z.number(),
  createdAt: z.string(),
});
export type WarehouseLocationDto = z.infer<typeof warehouseLocationDtoSchema>;

export const pickLocationSetSchema = z.object({
  itemId: z.string().uuid(),
  /** Localização preferencial de picking; null remove a atribuição */
  locationId: z.string().uuid().nullable(),
});
export type PickLocationSetInput = z.infer<typeof pickLocationSetSchema>;

// ── Artigos ─────────────────────────────────────────────────────────────────

export const itemCreateSchema = z.object({
  sku: z.string().trim().min(1).max(60).toUpperCase(),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).optional(),
  unit: z.string().trim().min(1).max(12).default("un"),
  weightKg: z.coerce.number().min(0).optional(),
  /** Artigo gerido por número de série — entradas/saídas exigem lista de séries */
  serialized: z.boolean().default(false),
});
export type ItemCreateInput = z.infer<typeof itemCreateSchema>;

export const itemUpdateSchema = itemCreateSchema.partial().extend({
  active: z.boolean().optional(),
});
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;

export const itemDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  unit: z.string(),
  weightKg: z.number().nullable(),
  serialized: z.boolean(),
  active: z.boolean(),
  totalStock: z.number(),
  createdAt: z.string(),
});
export type ItemDto = z.infer<typeof itemDtoSchema>;

export const listItemsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  active: z.enum(["true", "false"]).optional(),
});

// ── Stock e movimentos ──────────────────────────────────────────────────────

export const MOVEMENT_TYPES = ["in", "out", "adjust", "transfer"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export const movementTypeSchema = z.enum(MOVEMENT_TYPES);

export const stockLevelDtoSchema = z.object({
  warehouseId: z.string(),
  warehouseCode: z.string(),
  warehouseName: z.string(),
  itemId: z.string(),
  sku: z.string(),
  itemName: z.string(),
  unit: z.string(),
  onHand: z.number(),
  reserved: z.number(),
  reorderPoint: z.number().nullable(),
});
export type StockLevelDto = z.infer<typeof stockLevelDtoSchema>;

export const reorderPointUpdateSchema = z.object({
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  reorderPoint: z.number().int().min(0).nullable(),
});
export type ReorderPointUpdate = z.infer<typeof reorderPointUpdateSchema>;

export const stockAlertDtoSchema = stockLevelDtoSchema.extend({
  available: z.number(),
  deficit: z.number(),
});
export type StockAlertDto = z.infer<typeof stockAlertDtoSchema>;

// ── Lotes e validade ───────────────────────────────────────────────────────

export const stockLotDtoSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  sku: z.string(),
  itemName: z.string(),
  warehouseId: z.string(),
  warehouseCode: z.string(),
  code: z.string(),
  expiresAt: z.string().nullable(),
  onHand: z.number(),
  /** Dias até à validade; null sem data ou já expirado → <= 0 */
  daysToExpiry: z.number().nullable(),
});
export type StockLotDto = z.infer<typeof stockLotDtoSchema>;

export const listLotsQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  /** Só lotes que expiram dentro de N dias (inclui expirados) */
  expiringDays: z.coerce.number().int().min(0).max(3650).optional(),
});

export const listStockQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
});

export const movementCreateSchema = z
  .object({
    type: movementTypeSchema,
    itemId: z.string().uuid(),
    quantity: z.coerce.number().int(),
    warehouseId: z.string().uuid().optional(),
    toWarehouseId: z.string().uuid().optional(),
    reference: z.string().trim().max(80).optional(),
    note: z.string().trim().max(300).optional(),
    /** Lote da entrada (cria/atualiza o lote); validade opcional */
    lotCode: z.string().trim().min(1).max(60).optional(),
    lotExpiresAt: z.string().optional(),
    /** Bin de putaway da entrada; nas saídas indica de onde consumir */
    locationId: z.string().uuid().optional(),
    /** Números de série — obrigatório para artigos `serialized` (= quantidade) */
    serials: z.array(z.string().trim().min(1).max(80)).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.lotCode || v.lotExpiresAt) && v.type !== "in") {
      ctx.addIssue({ code: "custom", message: "Lote só é indicado em entradas" });
    }
    if (v.lotExpiresAt && !v.lotCode) {
      ctx.addIssue({ code: "custom", message: "Validade exige código de lote" });
    }
    if (v.serials?.length && v.type === "adjust") {
      ctx.addIssue({ code: "custom", message: "Ajustes não aceitam séries" });
    }
    if (v.type === "transfer") {
      if (!v.warehouseId || !v.toWarehouseId) {
        ctx.addIssue({ code: "custom", message: "Transferência exige armazém de origem e destino" });
      } else if (v.warehouseId === v.toWarehouseId) {
        ctx.addIssue({ code: "custom", message: "Origem e destino têm de ser diferentes" });
      }
      if (v.quantity <= 0) {
        ctx.addIssue({ code: "custom", message: "Quantidade deve ser positiva" });
      }
    } else {
      if (!v.warehouseId) {
        ctx.addIssue({ code: "custom", message: "Armazém obrigatório" });
      }
      if ((v.type === "in" || v.type === "out") && v.quantity <= 0) {
        ctx.addIssue({ code: "custom", message: "Quantidade deve ser positiva" });
      }
      if (v.type === "adjust" && v.quantity === 0) {
        ctx.addIssue({ code: "custom", message: "Ajuste não pode ser zero" });
      }
    }
  });
export type MovementCreateInput = z.infer<typeof movementCreateSchema>;

export const stockMovementDtoSchema = z.object({
  id: z.string(),
  type: movementTypeSchema,
  itemId: z.string(),
  sku: z.string(),
  itemName: z.string(),
  quantity: z.number(),
  warehouseId: z.string().nullable(),
  warehouseCode: z.string().nullable(),
  toWarehouseId: z.string().nullable(),
  toWarehouseCode: z.string().nullable(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  lotCode: z.string().nullable(),
  locationCode: z.string().nullable(),
  serials: z.array(z.string()).optional(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type StockMovementDto = z.infer<typeof stockMovementDtoSchema>;

// ── Stock por bin ──────────────────────────────────────────────────────────

export const stockBinLevelDtoSchema = z.object({
  locationId: z.string(),
  locationCode: z.string(),
  zone: z.string().nullable(),
  warehouseId: z.string(),
  warehouseCode: z.string(),
  itemId: z.string(),
  sku: z.string(),
  itemName: z.string(),
  onHand: z.number(),
});
export type StockBinLevelDto = z.infer<typeof stockBinLevelDtoSchema>;

export const listBinLevelsQuerySchema = z.object({
  warehouseId: z.string().uuid(),
  itemId: z.string().uuid().optional(),
});

/** Transferência bin-to-bin dentro do mesmo armazém. */
export const binTransferSchema = z
  .object({
    itemId: z.string().uuid(),
    warehouseId: z.string().uuid(),
    fromLocationId: z.string().uuid(),
    toLocationId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1),
    /** Obrigatório para artigos serializados (= quantidade) */
    serials: z.array(z.string().trim().min(1).max(80)).max(500).optional(),
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, {
    message: "Origem e destino têm de ser diferentes",
  });
export type BinTransferInput = z.infer<typeof binTransferSchema>;

// ── Números de série ───────────────────────────────────────────────────────

export const itemSerialDtoSchema = z.object({
  id: z.string(),
  serial: z.string(),
  status: z.string(),
  itemId: z.string(),
  sku: z.string(),
  itemName: z.string(),
  warehouseId: z.string(),
  warehouseCode: z.string(),
  createdAt: z.string(),
});
export type ItemSerialDto = z.infer<typeof itemSerialDtoSchema>;

export const ITEM_SERIAL_STATUSES = ["in_stock", "issued", "written_off"] as const;
export type ItemSerialStatus = (typeof ITEM_SERIAL_STATUSES)[number];

export const listSerialsQuerySchema = z.object({
  itemId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  status: z.enum(ITEM_SERIAL_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
});

// ── Reconciliação stock ↔ bins/lotes/séries ────────────────────────────────

/** Compara o `on_hand` do armazém com a soma dos bins, lotes e séries. */
export const stockReconciliationDtoSchema = z.object({
  warehouseId: z.string(),
  warehouseCode: z.string(),
  itemId: z.string(),
  sku: z.string(),
  itemName: z.string(),
  serialized: z.boolean(),
  onHand: z.number(),
  /** Soma dos bins (null se o artigo nunca teve movimentos com bin) */
  binsOnHand: z.number().nullable(),
  /** Soma dos lotes (null se o artigo nunca teve lotes) */
  lotsOnHand: z.number().nullable(),
  /** Séries em stock (só artigos serializados) */
  serialsInStock: z.number().nullable(),
  /** binsOnHand − onHand (0/null = ok) */
  binDiff: z.number().nullable(),
  lotDiff: z.number().nullable(),
  serialDiff: z.number().nullable(),
  discrepant: z.boolean(),
});
export type StockReconciliationDto = z.infer<typeof stockReconciliationDtoSchema>;

export const reconciliationQuerySchema = z.object({
  warehouseId: z.string().uuid(),
  /** true → só linhas com divergência */
  discrepantOnly: z.coerce.boolean().optional(),
});

export const listMovementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  type: movementTypeSchema.optional(),
});

// ── Contagem física de stock ────────────────────────────────────────────────

export const COUNT_STATUSES = ["open", "applied", "cancelled"] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];
export const countStatusSchema = z.enum(COUNT_STATUSES);

export const inventoryCountCreateSchema = z.object({
  warehouseId: z.string().uuid(),
  /** Omitido → todos os artigos com registo de stock no armazém */
  itemIds: z.array(z.string().uuid()).max(500).optional(),
});
export type InventoryCountCreateInput = z.infer<typeof inventoryCountCreateSchema>;

export const countLineUpdateSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        countedQty: z.coerce.number().int().min(0),
        /** Artigos serializados: lista das séries contadas (define countedQty) */
        serials: z.array(z.string().trim().min(1).max(80)).max(2000).optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type CountLineUpdateInput = z.infer<typeof countLineUpdateSchema>;

export const countLineDtoSchema = z.object({
  itemId: z.string(),
  sku: z.string(),
  itemName: z.string(),
  unit: z.string(),
  /** Artigo gerido por número de série — contagem é por lista de séries */
  serialized: z.boolean(),
  /** Stock em mão no momento da criação da contagem */
  expectedQty: z.number(),
  countedQty: z.number().nullable(),
  /** countedQty − expectedQty (null até ser contado) */
  variance: z.number().nullable(),
  /** Séries em stock esperadas (só artigos serializados) */
  expectedSerials: z.array(z.string()).optional(),
  /** Séries contadas (só artigos serializados, após contagem) */
  countedSerials: z.array(z.string()).nullable().optional(),
});
export type CountLineDto = z.infer<typeof countLineDtoSchema>;

export const inventoryCountDtoSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: countStatusSchema,
  warehouseId: z.string(),
  warehouseName: z.string(),
  lineCount: z.number(),
  countedLines: z.number(),
  createdAt: z.string(),
  appliedAt: z.string().nullable(),
});
export type InventoryCountDto = z.infer<typeof inventoryCountDtoSchema>;

export const inventoryCountDetailDtoSchema = inventoryCountDtoSchema.extend({
  lines: z.array(countLineDtoSchema),
});
export type InventoryCountDetailDto = z.infer<typeof inventoryCountDetailDtoSchema>;

export const listCountsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  warehouseId: z.string().uuid().optional(),
  status: countStatusSchema.optional(),
});

// ── Compras (cadeia de abastecimento) ───────────────────────────────────────

export const PO_STATUSES = [
  "draft",
  "sent",
  "partially_received",
  "received",
  "cancelled",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export const poStatusSchema = z.enum(PO_STATUSES);

export const PO_TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["cancelled"],
  partially_received: ["cancelled"],
  received: [],
  cancelled: [],
};

export const poLineSchema = z.object({
  itemId: z.string().uuid(),
  description: z.string().trim().max(200).optional(),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0).optional(),
});
export type PoLineInput = z.infer<typeof poLineSchema>;

export const poCreateSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  expectedDate: z.string().optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(poLineSchema).min(1, "A compra precisa de pelo menos uma linha"),
});
export type PoCreateInput = z.infer<typeof poCreateSchema>;

export const poStatusUpdateSchema = z.object({
  status: z.enum(["sent", "cancelled"]),
});
export type PoStatusUpdate = z.infer<typeof poStatusUpdateSchema>;

export const poReceiveSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1),
        lotCode: z.string().trim().max(80).optional(),
        lotExpiresAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (AAAA-MM-DD)")
          .optional(),
        /** Bin de putaway da receção */
        locationId: z.string().uuid().optional(),
        /** Obrigatório para artigos serializados (= quantidade) */
        serials: z.array(z.string().trim().min(1).max(80)).max(500).optional(),
      }),
    )
    .min(1),
});
export type PoReceiveInput = z.infer<typeof poReceiveSchema>;

export const poLineDtoSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  itemId: z.string(),
  sku: z.string(),
  itemName: z.string(),
  description: z.string().nullable(),
  quantity: z.number(),
  receivedQty: z.number(),
  unit: z.string(),
  unitPrice: z.number().nullable(),
});
export type PoLineDto = z.infer<typeof poLineDtoSchema>;

export const purchaseOrderDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  number: z.string(),
  status: poStatusSchema,
  supplierId: z.string(),
  supplierName: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  expectedDate: z.string().nullable(),
  notes: z.string().nullable(),
  lineCount: z.number(),
  totalQty: z.number(),
  receivedQty: z.number(),
  createdAt: z.string(),
});
export type PurchaseOrderDto = z.infer<typeof purchaseOrderDtoSchema>;

export const purchaseOrderDetailDtoSchema = purchaseOrderDtoSchema.extend({
  lines: z.array(poLineDtoSchema),
});
export type PurchaseOrderDetailDto = z.infer<typeof purchaseOrderDetailDtoSchema>;

export const listPoQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: poStatusSchema.optional(),
  supplierId: z.string().uuid().optional(),
});

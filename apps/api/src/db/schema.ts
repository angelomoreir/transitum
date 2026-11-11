import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "manager", "operator", "viewer", "driver"]);
export const userStatusEnum = pgEnum("user_status", ["invited", "active", "suspended"]);
export const authTokenTypeEnum = pgEnum("auth_token_type", ["invite", "reset"]);
export const partnerTypeEnum = pgEnum("partner_type", ["customer", "supplier", "carrier"]);
export const orderStatusEnum = pgEnum("order_status", ["draft", "confirmed", "cancelled"]);
export const shipmentStatusEnum = pgEnum("shipment_status", [
  "draft",
  "planned",
  "in_transit",
  "delivered",
  "cancelled",
]);
export const carrierInvoiceStatusEnum = pgEnum("carrier_invoice_status", [
  "pending",
  "matched",
  "discrepancy",
]);
export const countStatusEnum = pgEnum("count_status", ["open", "applied", "cancelled"]);
export const vehicleTypeEnum = pgEnum("vehicle_type", [
  "van",
  "truck",
  "car",
  "motorcycle",
  "other",
]);
export const returnStatusEnum = pgEnum("return_status", ["draft", "received", "cancelled"]);
export const webhookSourceEnum = pgEnum("webhook_source", [
  "shopify",
  "woocommerce",
  "generic",
  "edifact",
]);

export const pickWaveStatusEnum = pgEnum("pick_wave_status", [
  "open",
  "in_progress",
  "done",
  "cancelled",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull(),
  plan: varchar("plan", { length: 32 }).notNull().default("trial"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  // Dados fiscais do emitente (guias de transporte / AT)
  taxId: varchar("tax_id", { length: 32 }),
  addressLine1: varchar("address_line1", { length: 160 }),
  city: varchar("city", { length: 80 }),
  postalCode: varchar("postal_code", { length: 16 }),
  country: varchar("country", { length: 2 }).default("PT"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    // Email globalmente único — permite login sem selecionar empresa
    email: varchar("email", { length: 254 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    passwordHash: text("password_hash"),
    role: roleEnum("role").notNull().default("operator"),
    status: userStatusEnum("status").notNull().default("invited"),
    // Segredo TOTP cifrado (v1.<iv>.<tag>.<ct>) — preenchido no enroll
    totpSecret: text("totp_secret"),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_tenant_idx").on(t.tenantId),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id"),
    ip: varchar("ip", { length: 45 }),
    userAgent: varchar("user_agent", { length: 255 }),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_unique").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId),
    index("refresh_tokens_tenant_idx").on(t.tenantId),
  ],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: authTokenTypeEnum("type").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_tokens_hash_unique").on(t.tokenHash),
    index("auth_tokens_user_idx").on(t.userId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actorId: uuid("actor_id"),
    action: varchar("action", { length: 80 }).notNull(),
    entity: varchar("entity", { length: 60 }),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: varchar("ip", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

// ---- Fase 2: parceiros, encomendas, expedições ----

/** Numeração sequencial por tenant (ENC-00001, EXP-00001, CLI-0001). */
export const sequences = pgTable(
  "sequences",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    key: varchar("key", { length: 32 }).notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export const partners = pgTable(
  "partners",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    code: varchar("code", { length: 24 }).notNull(),
    types: partnerTypeEnum("types").array().notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    taxId: varchar("tax_id", { length: 32 }),
    email: varchar("email", { length: 254 }),
    phone: varchar("phone", { length: 32 }),
    addressLine1: varchar("address_line1", { length: 160 }),
    city: varchar("city", { length: 80 }),
    postalCode: varchar("postal_code", { length: 16 }),
    country: varchar("country", { length: 2 }).notNull().default("PT"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    /** Token do portal do cliente (link público com encomendas e expedições) */
    portalToken: varchar("portal_token", { length: 48 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("partners_tenant_code_unique").on(t.tenantId, t.code),
    uniqueIndex("partners_portal_token_unique").on(t.portalToken),
    index("partners_tenant_idx").on(t.tenantId),
    index("partners_name_idx").on(t.tenantId, t.name),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    number: varchar("number", { length: 24 }).notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => partners.id),
    status: orderStatusEnum("status").notNull().default("draft"),
    requestedDate: date("requested_date"),
    notes: text("notes"),
    deliveryLine1: varchar("delivery_line1", { length: 160 }),
    deliveryCity: varchar("delivery_city", { length: 80 }),
    deliveryPostalCode: varchar("delivery_postal_code", { length: 16 }),
    deliveryCountry: varchar("delivery_country", { length: 2 }),
    /** Armazém de onde sai a mercadoria (reserva/saída de stock) */
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    /** Referência do sistema externo (intake EDI/e-commerce — idempotente) */
    externalRef: varchar("external_ref", { length: 80 }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_tenant_number_unique").on(t.tenantId, t.number),
    uniqueIndex("orders_tenant_external_unique").on(t.tenantId, t.externalRef),
    index("orders_tenant_idx").on(t.tenantId),
    index("orders_customer_idx").on(t.tenantId, t.customerId),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    lineNo: integer("line_no").notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    weightKg: doublePrecision("weight_kg"),
    itemId: uuid("item_id").references(() => items.id),
    unitPrice: doublePrecision("unit_price"),
    /** Quantidade reservada em stock e ainda não expedida */
    reservedQty: integer("reserved_qty").notNull().default(0),
    /** Quantidade já atribuída a expedições (não canceladas) */
    shippedQty: integer("shipped_qty").notNull().default(0),
  },
  (t) => [index("order_lines_order_idx").on(t.orderId)],
);

export const customsStatusEnum = pgEnum("customs_status", [
  "none",
  "prepared",
  "submitted",
  "cleared",
  "held",
]);

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    number: varchar("number", { length: 24 }).notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => partners.id),
    carrierId: uuid("carrier_id").references(() => partners.id),
    status: shipmentStatusEnum("status").notNull().default("draft"),
    pickupLine1: varchar("pickup_line1", { length: 160 }).notNull(),
    pickupCity: varchar("pickup_city", { length: 80 }).notNull(),
    pickupPostalCode: varchar("pickup_postal_code", { length: 16 }).notNull(),
    pickupCountry: varchar("pickup_country", { length: 2 }).notNull(),
    deliveryLine1: varchar("delivery_line1", { length: 160 }).notNull(),
    deliveryCity: varchar("delivery_city", { length: 80 }).notNull(),
    deliveryPostalCode: varchar("delivery_postal_code", { length: 16 }).notNull(),
    deliveryCountry: varchar("delivery_country", { length: 2 }).notNull(),
    plannedPickupAt: timestamp("planned_pickup_at", { withTimezone: true }),
    plannedDeliveryAt: timestamp("planned_delivery_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    totalWeightKg: doublePrecision("total_weight_kg"),
    packages: integer("packages"),
    incoterm: varchar("incoterm", { length: 4 }),
    customsStatus: customsStatusEnum("customs_status").notNull().default("none"),
    notes: text("notes"),
    // Destinatário (notificações e tracking público)
    recipientName: varchar("recipient_name", { length: 120 }),
    recipientEmail: varchar("recipient_email", { length: 254 }),
    recipientPhone: varchar("recipient_phone", { length: 32 }),
    notifyRecipient: boolean("notify_recipient").notNull().default(true),
    trackingToken: varchar("tracking_token", { length: 40 }),
    // Geolocalização e distância
    pickupLat: doublePrecision("pickup_lat"),
    pickupLng: doublePrecision("pickup_lng"),
    deliveryLat: doublePrecision("delivery_lat"),
    deliveryLng: doublePrecision("delivery_lng"),
    distanceKm: doublePrecision("distance_km"),
    vehicleRef: varchar("vehicle_ref", { length: 40 }),
    /** Momento em que o stock saiu do armazém (expedição em trânsito) */
    stockIssuedAt: timestamp("stock_issued_at", { withTimezone: true }),
    // Integração com transportadora
    carrierProvider: varchar("carrier_provider", { length: 16 }),
    trackingNumber: varchar("tracking_number", { length: 60 }),
    carrierRef: varchar("carrier_ref", { length: 80 }),
    carrierBookedAt: timestamp("carrier_booked_at", { withTimezone: true }),
    carrierSyncedAt: timestamp("carrier_synced_at", { withTimezone: true }),
    /** Alerta de atraso já notificado (scheduler) */
    lateAlertedAt: timestamp("late_alerted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shipments_tenant_number_unique").on(t.tenantId, t.number),
    index("shipments_tenant_idx").on(t.tenantId),
    index("shipments_status_idx").on(t.tenantId, t.status),
    index("shipments_customer_idx").on(t.tenantId, t.customerId),
    uniqueIndex("shipments_tracking_token_unique").on(t.trackingToken),
    index("shipments_tracking_number_idx").on(t.trackingNumber),
  ],
);

/** Linhas de mercadoria da expedição (copiadas da encomenda ou livres). */
export const shipmentLines = pgTable(
  "shipment_lines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id),
    orderLineId: uuid("order_line_id").references(() => orderLines.id),
    itemId: uuid("item_id").references(() => items.id),
    lineNo: integer("line_no").notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    quantity: integer("quantity").notNull(),
    unit: varchar("unit", { length: 12 }).notNull().default("UN"),
    weightKg: doublePrecision("weight_kg"),
    unitPrice: doublePrecision("unit_price"),
  },
  (t) => [index("shipment_lines_shipment_idx").on(t.shipmentId)],
);

export const shipmentEvents = pgTable(
  "shipment_events",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id),
    type: varchar("type", { length: 40 }).notNull(),
    status: shipmentStatusEnum("status"),
    description: text("description").notNull(),
    location: varchar("location", { length: 160 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shipment_events_shipment_idx").on(t.shipmentId, t.occurredAt),
    index("shipment_events_tenant_idx").on(t.tenantId),
  ],
);

// ---- Fase 3: rotas, custos, tarifas ----

export const routeStatusEnum = pgEnum("route_status", [
  "draft",
  "dispatched",
  "completed",
  "cancelled",
]);
export const stopTypeEnum = pgEnum("stop_type", ["pickup", "delivery"]);
export const stopStatusEnum = pgEnum("stop_status", [
  "pending",
  "arrived",
  "done",
  "skipped",
]);
export const rateBasisEnum = pgEnum("rate_basis", [
  "flat",
  "per_kg",
  "per_km",
  "per_package",
]);
export const costTypeEnum = pgEnum("cost_type", ["freight", "fuel", "tolls", "other"]);

export const routes = pgTable(
  "routes",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    number: varchar("number", { length: 24 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    carrierId: uuid("carrier_id").references(() => partners.id),
    driverName: varchar("driver_name", { length: 120 }),
    /** Utilizador motorista (app móvel) */
    driverUserId: uuid("driver_user_id").references(() => users.id),
    /** Viatura da frota atribuída (mantém `vehicle_ref` para texto livre) */
    vehicleId: uuid("vehicle_id").references(() => vehicles.id),
    vehicleRef: varchar("vehicle_ref", { length: 40 }),
    status: routeStatusEnum("status").notNull().default("draft"),
    plannedStartAt: timestamp("planned_start_at", { withTimezone: true }),
    plannedEndAt: timestamp("planned_end_at", { withTimezone: true }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("routes_tenant_number_unique").on(t.tenantId, t.number),
    index("routes_tenant_idx").on(t.tenantId),
    index("routes_status_idx").on(t.tenantId, t.status),
  ],
);

export const routeStops = pgTable(
  "route_stops",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    seq: integer("seq").notNull(),
    type: stopTypeEnum("type").notNull(),
    status: stopStatusEnum("status").notNull().default("pending"),
    addressLine1: varchar("address_line1", { length: 160 }).notNull(),
    city: varchar("city", { length: 80 }).notNull(),
    postalCode: varchar("postal_code", { length: 16 }).notNull(),
    country: varchar("country", { length: 2 }).notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    plannedAt: timestamp("planned_at", { withTimezone: true }),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    note: varchar("note", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("route_stops_route_idx").on(t.routeId, t.seq),
    index("route_stops_tenant_idx").on(t.tenantId),
    index("route_stops_shipment_idx").on(t.shipmentId),
  ],
);

export const carrierRates = pgTable(
  "carrier_rates",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    carrierId: uuid("carrier_id")
      .notNull()
      .references(() => partners.id),
    name: varchar("name", { length: 120 }).notNull(),
    basis: rateBasisEnum("basis").notNull(),
    price: doublePrecision("price").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    minCharge: doublePrecision("min_charge"),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    active: boolean("active").notNull().default(true),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("carrier_rates_tenant_idx").on(t.tenantId),
    index("carrier_rates_carrier_idx").on(t.tenantId, t.carrierId),
  ],
);

export const shipmentCosts = pgTable(
  "shipment_costs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id),
    type: costTypeEnum("type").notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    /** Tarifa usada no cálculo automático (null = custo manual) */
    rateId: uuid("rate_id").references(() => carrierRates.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shipment_costs_shipment_idx").on(t.shipmentId),
    index("shipment_costs_tenant_idx").on(t.tenantId),
  ],
);

// ---- Fase 4: armazéns, inventário, compras ----

export const movementTypeEnum = pgEnum("movement_type", [
  "in",
  "out",
  "adjust",
  "transfer",
]);
export const poStatusEnum = pgEnum("po_status", [
  "draft",
  "sent",
  "partially_received",
  "received",
  "cancelled",
]);

export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    code: varchar("code", { length: 24 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    addressLine1: varchar("address_line1", { length: 160 }),
    city: varchar("city", { length: 80 }),
    postalCode: varchar("postal_code", { length: 16 }),
    country: varchar("country", { length: 2 }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("warehouses_tenant_code_unique").on(t.tenantId, t.code),
    index("warehouses_tenant_idx").on(t.tenantId),
  ],
);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    sku: varchar("sku", { length: 60 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: varchar("description", { length: 500 }),
    unit: varchar("unit", { length: 12 }).notNull().default("un"),
    weightKg: doublePrecision("weight_kg"),
    /** Artigo gerido por número de série (entrada/saída exige lista de séries) */
    serialized: boolean("serialized").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("items_tenant_sku_unique").on(t.tenantId, t.sku),
    index("items_tenant_idx").on(t.tenantId),
  ],
);

/** Números de série de artigos `serialized` — estado por unidade física. */
export const itemSerials = pgTable(
  "item_serials",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    serial: varchar("serial", { length: 80 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("in_stock"), // in_stock | issued | written_off
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("item_serials_unique").on(t.tenantId, t.itemId, t.serial),
    index("item_serials_wh_idx").on(t.tenantId, t.warehouseId),
  ],
);

/**
 * Stock por localização (bin) — desagregação informativa do `on_hand` por
 * `warehouse_location`, como os lotes. Receções indicam o bin (putaway);
 * saídas consomem primeiro da localização preferencial de picking.
 */
export const stockBinLevels = pgTable(
  "stock_bin_levels",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => warehouseLocations.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    onHand: integer("on_hand").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_bin_levels_unique").on(t.tenantId, t.locationId, t.itemId),
    index("stock_bin_levels_item_idx").on(t.tenantId, t.itemId),
  ],
);

/** Localizações físicas dentro do armazém (bins/zonas) */
export const warehouseLocations = pgTable(
  "warehouse_locations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    code: varchar("code", { length: 24 }).notNull(),
    zone: varchar("zone", { length: 40 }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("warehouse_locations_unique").on(t.tenantId, t.warehouseId, t.code),
    index("warehouse_locations_wh_idx").on(t.tenantId, t.warehouseId),
  ],
);

/** Localização preferencial de picking por (armazém, artigo) */
export const itemPickLocations = pgTable(
  "item_pick_locations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => warehouseLocations.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("item_pick_locations_unique").on(t.tenantId, t.warehouseId, t.itemId)],
);

export const stockLevels = pgTable(
  "stock_levels",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    // Ponto de reposição: alerta quando disponível (on_hand - reserved) <= reorder_point
    reorderPoint: integer("reorder_point"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_levels_wh_item_unique").on(t.tenantId, t.warehouseId, t.itemId),
    index("stock_levels_warehouse_idx").on(t.tenantId, t.warehouseId),
    index("stock_levels_item_idx").on(t.tenantId, t.itemId),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    type: movementTypeEnum("type").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    quantity: integer("quantity").notNull(),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    toWarehouseId: uuid("to_warehouse_id").references(() => warehouses.id),
    reference: varchar("reference", { length: 80 }),
    note: varchar("note", { length: 300 }),
    /** Lote movimentado (entradas criam/atualizam o lote; saídas consomem FEFO) */
    lotCode: varchar("lot_code", { length: 60 }),
    /** Bin de origem/destino (putaway e transferências bin-to-bin) */
    locationId: uuid("location_id").references(() => warehouseLocations.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_movements_item_idx").on(t.tenantId, t.itemId),
    index("stock_movements_warehouse_idx").on(t.tenantId, t.warehouseId),
    index("stock_movements_tenant_idx").on(t.tenantId, t.createdAt),
  ],
);

/** Lotes de stock com validade — desagregação do on_hand por lote (FEFO). */
export const stockLots = pgTable(
  "stock_lots",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    code: varchar("code", { length: 60 }).notNull(),
    expiresAt: date("expires_at"),
    onHand: integer("on_hand").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_lots_unique").on(t.tenantId, t.warehouseId, t.itemId, t.code),
    index("stock_lots_expiry_idx").on(t.tenantId, t.expiresAt),
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    number: varchar("number", { length: 24 }).notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => partners.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    status: poStatusEnum("status").notNull().default("draft"),
    expectedDate: date("expected_date"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("purchase_orders_tenant_number_unique").on(t.tenantId, t.number),
    index("purchase_orders_tenant_idx").on(t.tenantId),
    index("purchase_orders_supplier_idx").on(t.tenantId, t.supplierId),
  ],
);

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    lineNo: integer("line_no").notNull(),
    description: varchar("description", { length: 200 }),
    quantity: integer("quantity").notNull(),
    receivedQty: integer("received_qty").notNull().default(0),
    unitPrice: doublePrecision("unit_price"),
  },
  (t) => [
    index("po_lines_po_idx").on(t.poId),
    index("po_lines_item_idx").on(t.tenantId, t.itemId),
  ],
);

// ---- Fase 5: documentos, notificações, automatizações ----

export const docEntityTypeEnum = pgEnum("doc_entity_type", [
  "shipment",
  "order",
  "purchase_order",
  "partner",
  "route",
]);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    entityType: docEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    fileName: varchar("file_name", { length: 200 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: varchar("storage_key", { length: 300 }).notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_entity_idx").on(t.tenantId, t.entityType, t.entityId),
    index("documents_tenant_idx").on(t.tenantId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    type: varchar("type", { length: 60 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body"),
    link: varchar("link", { length: 300 }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.readAt),
    index("notifications_tenant_idx").on(t.tenantId, t.createdAt),
  ],
);

export const automationRules = pgTable(
  "automation_rules",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: varchar("name", { length: 160 }).notNull(),
    trigger: varchar("trigger", { length: 60 }).notNull(),
    action: varchar("action", { length: 40 }).notNull().default("notify"),
    webhookUrl: varchar("webhook_url", { length: 300 }),
    webhookSecret: varchar("webhook_secret", { length: 80 }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("automation_rules_tenant_idx").on(t.tenantId),
    index("automation_rules_trigger_idx").on(t.tenantId, t.trigger, t.active),
  ],
);

// ---- Fase 6: comércio internacional, integrações, API pública ----
// (customsStatusEnum declarado antes de `shipments`)

export const customsItems = pgTable(
  "customs_items",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id),
    description: varchar("description", { length: 200 }).notNull(),
    hsCode: varchar("hs_code", { length: 10 }),
    originCountry: varchar("origin_country", { length: 2 }),
    quantity: doublePrecision("quantity").notNull().default(1),
    weightKg: doublePrecision("weight_kg"),
    value: doublePrecision("value"),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customs_items_shipment_idx").on(t.tenantId, t.shipmentId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: varchar("name", { length: 120 }).notNull(),
    prefix: varchar("prefix", { length: 12 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    active: boolean("active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("api_keys_tenant_idx").on(t.tenantId),
    index("api_keys_hash_idx").on(t.keyHash),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    ruleId: uuid("rule_id").references(() => automationRules.id),
    url: varchar("url", { length: 300 }).notNull(),
    trigger: varchar("trigger", { length: 60 }).notNull(),
    payload: jsonb("payload"),
    statusCode: integer("status_code"),
    success: boolean("success").notNull().default(false),
    attempts: integer("attempts").notNull().default(1),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    error: varchar("error", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_tenant_idx").on(t.tenantId, t.createdAt),
    index("webhook_deliveries_retry_idx").on(t.nextRetryAt),
  ],
);

// ── Fase 7: subscrições, faturação e administração SaaS ─────────────────────

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "cancelled",
]);
export const invoiceStatusEnum = pgEnum("saas_invoice_status", ["open", "paid", "void"]);

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 60 }).notNull(),
  priceMonthly: doublePrecision("price_monthly").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
  maxUsers: integer("max_users").notNull(),
  maxApiKeys: integer("max_api_keys").notNull(),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .unique()
      .references(() => tenants.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatusEnum("status").notNull().default("trialing"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subscriptions_status_idx").on(t.status)],
);

export const subscriptionInvoices = pgTable(
  "subscription_invoices",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    number: varchar("number", { length: 20 }).notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    status: invoiceStatusEnum("status").notNull().default("open"),
    description: varchar("description", { length: 255 }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subscription_invoices_tenant_idx").on(t.tenantId, t.createdAt),
    uniqueIndex("subscription_invoices_tenant_number_idx").on(t.tenantId, t.number),
  ],
);

export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Fase 9: documentos de transporte/AT, geolocalização, motorista, transportadoras ──

/** Configuração de comunicação de documentos de transporte à AT (por tenant). */
export const atSettings = pgTable("at_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  enabled: boolean("enabled").notNull().default(false),
  environment: varchar("environment", { length: 12 }).notNull().default("test"),
  /** Subutilizador do Portal das Finanças, ex.: 599999993/37 */
  username: varchar("username", { length: 40 }),
  /** Palavra-passe cifrada (AES-256-GCM) */
  passwordEnc: text("password_enc"),
  docType: varchar("doc_type", { length: 2 }).notNull().default("GT"),
  series: varchar("series", { length: 20 }).notNull().default("A"),
  /** Código de validação da série comunicado pela AT (prefixo do ATCUD) */
  seriesValidationCode: varchar("series_validation_code", { length: 20 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transportDocStatusEnum = pgEnum("transport_doc_status", [
  "issued",
  "communicated",
  "failed",
]);

export const transportDocuments = pgTable(
  "transport_documents",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id),
    docType: varchar("doc_type", { length: 2 }).notNull(),
    series: varchar("series", { length: 20 }).notNull(),
    seq: integer("seq").notNull(),
    /** Identificação única (SAF-T), ex.: "GT A/12" */
    number: varchar("number", { length: 60 }).notNull(),
    atcud: varchar("atcud", { length: 60 }).notNull(),
    movementStartAt: timestamp("movement_start_at", { withTimezone: true }).notNull(),
    vehicleRef: varchar("vehicle_ref", { length: 40 }),
    /** Assinatura RSA-SHA1 (Portaria 363/2010); vazia se a chave não estiver configurada */
    hash: text("hash"),
    hashControl: varchar("hash_control", { length: 40 }),
    status: transportDocStatusEnum("status").notNull().default("issued"),
    environment: varchar("environment", { length: 12 }),
    atDocCode: varchar("at_doc_code", { length: 40 }),
    atMessage: varchar("at_message", { length: 500 }),
    communicatedAt: timestamp("communicated_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transport_docs_series_seq_unique").on(t.tenantId, t.docType, t.series, t.seq),
    index("transport_docs_shipment_idx").on(t.tenantId, t.shipmentId),
  ],
);

/** Cache de geocodificação (morada normalizada → coordenadas). */
export const geocodeCache = pgTable("geocode_cache", {
  key: varchar("key", { length: 300 }).primaryKey(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Posições GPS enviadas pela app do motorista. */
export const routePositions = pgTable(
  "route_positions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id),
    userId: uuid("user_id").references(() => users.id),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accuracyM: doublePrecision("accuracy_m"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("route_positions_route_idx").on(t.routeId, t.recordedAt)],
);

/** Prova de entrega/recolha capturada na app do motorista. */
export const proofsOfDelivery = pgTable(
  "proofs_of_delivery",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    stopId: uuid("stop_id")
      .notNull()
      .references(() => routeStops.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    recipientName: varchar("recipient_name", { length: 120 }).notNull(),
    signatureDocId: uuid("signature_doc_id").references(() => documents.id),
    photoDocId: uuid("photo_doc_id").references(() => documents.id),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    note: varchar("note", { length: 300 }),
    capturedBy: uuid("captured_by").references(() => users.id),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pod_shipment_idx").on(t.tenantId, t.shipmentId),
    index("pod_stop_idx").on(t.stopId),
  ],
);

/** Ligação de uma transportadora (parceiro) a um fornecedor de API (CTT, DPD, Nacex). */
export const carrierConnections = pgTable(
  "carrier_connections",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    carrierId: uuid("carrier_id")
      .notNull()
      .references(() => partners.id),
    provider: varchar("provider", { length: 16 }).notNull(),
    mode: varchar("mode", { length: 12 }).notNull().default("sandbox"),
    /** Credenciais cifradas (JSON) */
    credentialsEnc: text("credentials_enc"),
    /** Configuração não secreta (ex.: agência, nº cliente, serviço) */
    config: jsonb("config").$type<Record<string, string>>(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("carrier_connections_carrier_unique").on(t.tenantId, t.carrierId)],
);

/**
 * Fatura de frete emitida pela transportadora, para auditoria contra o custo
 * acordado/registado na expedição (`expected_amount` = soma dos custos freight
 * da expedição no momento do registo da fatura).
 */
export const carrierInvoices = pgTable(
  "carrier_invoices",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    carrierId: uuid("carrier_id")
      .notNull()
      .references(() => partners.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    invoiceNumber: varchar("invoice_number", { length: 60 }).notNull(),
    amount: doublePrecision("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    expectedAmount: doublePrecision("expected_amount"),
    variance: doublePrecision("variance"),
    status: carrierInvoiceStatusEnum("status").notNull().default("pending"),
    issuedAt: date("issued_at"),
    note: varchar("note", { length: 300 }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("carrier_invoices_tenant_idx").on(t.tenantId, t.createdAt),
    index("carrier_invoices_carrier_idx").on(t.tenantId, t.carrierId),
    index("carrier_invoices_shipment_idx").on(t.shipmentId),
  ],
);

/**
 * Contagem física de stock: snapshot do `on_hand` por artigo no armazém
 * (`expected_qty`), valores contados e aplicação de ajustes via movimentos
 * `adjust` ao confirmar.
 */
export const inventoryCounts = pgTable(
  "inventory_counts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    number: varchar("number", { length: 24 }).notNull(),
    status: countStatusEnum("status").notNull().default("open"),
    createdBy: uuid("created_by").references(() => users.id),
    appliedBy: uuid("applied_by").references(() => users.id),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_counts_tenant_number_unique").on(t.tenantId, t.number),
    index("inventory_counts_tenant_idx").on(t.tenantId, t.createdAt),
  ],
);

export const inventoryCountLines = pgTable(
  "inventory_count_lines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    countId: uuid("count_id")
      .notNull()
      .references(() => inventoryCounts.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    expectedQty: integer("expected_qty").notNull(),
    countedQty: integer("counted_qty"),
    /** Séries contadas (JSON array) — artigos serializados contam-se por série */
    countedSerials: text("counted_serials"),
  },
  (t) => [
    uniqueIndex("inventory_count_lines_count_item_unique").on(t.countId, t.itemId),
    index("inventory_count_lines_count_idx").on(t.tenantId, t.countId),
  ],
);

// ---- Waves de picking persistidas ----

/** Wave de picking: conjunto de linhas por expedir atribuído a um operador. */
export const pickWaves = pgTable(
  "pick_waves",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    number: varchar("number", { length: 24 }).notNull(),
    status: pickWaveStatusEnum("status").notNull().default("open"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pick_waves_tenant_number_unique").on(t.tenantId, t.number),
    index("pick_waves_tenant_idx").on(t.tenantId, t.status),
    index("pick_waves_assignee_idx").on(t.assignedTo),
  ],
);

export const pickWaveLines = pgTable(
  "pick_wave_lines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    waveId: uuid("wave_id")
      .notNull()
      .references(() => pickWaves.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLines.id),
    itemId: uuid("item_id").references(() => items.id),
    sku: varchar("sku", { length: 60 }),
    itemName: varchar("item_name", { length: 200 }).notNull(),
    /** Localização preferencial no momento da criação (zona-código) */
    location: varchar("location", { length: 80 }),
    quantity: integer("quantity").notNull(),
    pickedQty: integer("picked_qty").notNull().default(0),
    pickedAt: timestamp("picked_at", { withTimezone: true }),
    pickedBy: uuid("picked_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("pick_wave_lines_wave_line_unique").on(t.waveId, t.orderLineId),
    index("pick_wave_lines_wave_idx").on(t.tenantId, t.waveId),
  ],
);

// ---- SSO / OIDC ----

/**
 * Fornecedor OIDC por tenant: discovery pelo domínio do email.
 * clientSecretEnc cifrado com AES-256-GCM (lib/secrets).
 */
export const ssoProviders = pgTable(
  "sso_providers",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: varchar("name", { length: 120 }).notNull(),
    /** Domínio de email que identifica o fornecedor (empresa.pt) */
    domain: varchar("domain", { length: 160 }).notNull(),
    clientId: varchar("client_id", { length: 300 }).notNull(),
    clientSecretEnc: text("client_secret_enc").notNull(),
    authorizeUrl: varchar("authorize_url", { length: 500 }).notNull(),
    tokenUrl: varchar("token_url", { length: 500 }).notNull(),
    userinfoUrl: varchar("userinfo_url", { length: 500 }),
    enabled: boolean("enabled").notNull().default(true),
    /** Cria a conta no primeiro login com a função defaultRole */
    autoProvision: boolean("auto_provision").notNull().default(false),
    defaultRole: roleEnum("default_role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sso_providers_tenant_domain_unique").on(t.tenantId, t.domain),
    index("sso_providers_domain_idx").on(t.domain),
  ],
);

/** Estados transitórios do fluxo OIDC (state + nonce, 10 min). */
export const ssoStates = pgTable(
  "sso_states",
  {
    state: varchar("state", { length: 80 }).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => ssoProviders.id),
    nonce: varchar("nonce", { length: 80 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// ---- Fase 12: frota e devoluções ----

/** Viatura da frota própria — atribuível a rotas (capacidade para validação). */
export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    plate: varchar("plate", { length: 20 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    type: vehicleTypeEnum("type").notNull().default("van"),
    capacityKg: doublePrecision("capacity_kg"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vehicles_tenant_plate_unique").on(t.tenantId, t.plate),
    index("vehicles_tenant_idx").on(t.tenantId),
  ],
);

/** Devolução (RMA): mercadoria que volta do cliente para um armazém. */
export const returns = pgTable(
  "returns",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    number: varchar("number", { length: 24 }).notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => partners.id),
    orderId: uuid("order_id").references(() => orders.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    status: returnStatusEnum("status").notNull().default("draft"),
    reason: varchar("reason", { length: 300 }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("returns_tenant_number_unique").on(t.tenantId, t.number),
    index("returns_tenant_idx").on(t.tenantId, t.createdAt),
  ],
);

export const returnLines = pgTable(
  "return_lines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    returnId: uuid("return_id")
      .notNull()
      .references(() => returns.id),
    lineNo: integer("line_no").notNull().default(0),
    itemId: uuid("item_id").references(() => items.id),
    description: varchar("description", { length: 200 }).notNull(),
    quantity: integer("quantity").notNull(),
    receivedQty: integer("received_qty").notNull().default(0),
  },
  (t) => [index("return_lines_return_idx").on(t.tenantId, t.returnId)],
);

/** Canais de entrada via webhook — Shopify, WooCommerce ou sistema genérico. */
export const inboundChannels = pgTable(
  "inbound_channels",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: varchar("name", { length: 120 }).notNull(),
    source: webhookSourceEnum("source").notNull(),
    /** Token público do URL de entrada (/api/inbound/<token>) */
    token: varchar("token", { length: 48 }).notNull(),
    /** Segredo HMAC para verificar a assinatura — guardado cifrado */
    secret: text("secret").notNull(),
    active: boolean("active").notNull().default(true),
    lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inbound_channels_token_unique").on(t.token),
    index("inbound_channels_tenant_idx").on(t.tenantId),
  ],
);

// ── Matriz de distâncias (OSRM) ────────────────────────────────────────────

/**
 * Cache global de distâncias rodoviárias calculadas pelo router (OSRM).
 * A chave é o par de coordenadas arredondadas a ~11 m (4 casas decimais).
 */
export const distanceCache = pgTable(
  "distance_cache",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    key: varchar("key", { length: 120 }).notNull(),
    km: doublePrecision("km").notNull(),
    durationMin: doublePrecision("duration_min"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("distance_cache_key_unique").on(t.key)],
);

// ── Faturação ao cliente ────────────────────────────────────────────────────

export const salesInvoiceStatusEnum = pgEnum("sales_invoice_status", [
  "draft",
  "issued",
  "paid",
  "void",
]);

export const salesInvoices = pgTable(
  "sales_invoices",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    number: varchar("number", { length: 24 }).notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => partners.id),
    orderId: uuid("order_id").references(() => orders.id),
    status: salesInvoiceStatusEnum("status").notNull().default("draft"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    /** Série do documento (AT) e sequência dentro dela */
    series: varchar("series", { length: 8 }).notNull().default("FT"),
    seq: integer("seq"),
    /** ATCUD atribuído na emissão (codigoValidacao-seq) */
    atcud: varchar("atcud", { length: 80 }),
    /** Assinatura RSA-SHA1 encadeada (Portaria 363/2010) */
    hash: text("hash"),
    hashControl: varchar("hash_control", { length: 20 }),
    /** Estado fiscal: unsigned | signed | communicated | failed */
    atStatus: varchar("at_status", { length: 20 }),
    atMessage: varchar("at_message", { length: 500 }),
    /** Base tributável (sem IVA) */
    subtotal: doublePrecision("subtotal").notNull().default(0),
    /** Total do IVA */
    taxTotal: doublePrecision("tax_total").notNull().default(0),
    /** Total com IVA */
    total: doublePrecision("total").notNull().default(0),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sales_invoices_tenant_number_unique").on(t.tenantId, t.number),
    index("sales_invoices_tenant_idx").on(t.tenantId),
    index("sales_invoices_customer_idx").on(t.tenantId, t.customerId),
    index("sales_invoices_series_idx").on(t.tenantId, t.series, t.seq),
  ],
);

export const salesInvoiceLines = pgTable(
  "sales_invoice_lines",
  {
    id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => salesInvoices.id),
    lineNo: integer("line_no").notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: doublePrecision("unit_price").notNull().default(0),
    /** Taxa de IVA em % */
    taxRate: doublePrecision("tax_rate").notNull().default(23),
    /** IVA da linha */
    taxAmount: doublePrecision("tax_amount").notNull().default(0),
    lineTotal: doublePrecision("line_total").notNull().default(0),
  },
  (t) => [index("sales_invoice_lines_invoice_idx").on(t.tenantId, t.invoiceId)],
);


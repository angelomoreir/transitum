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

export const roleEnum = pgEnum("role", ["admin", "manager", "operator", "viewer"]);
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

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull(),
  plan: varchar("plan", { length: 32 }).notNull().default("trial"),
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

// ---- Fase 2: parceiros, encomendas, expedi��es ----

/** Numera��o sequencial por tenant (ENC-00001, EXP-00001, CLI-0001�). */
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("partners_tenant_code_unique").on(t.tenantId, t.code),
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
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_tenant_number_unique").on(t.tenantId, t.number),
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
  },
  (t) => [index("order_lines_order_idx").on(t.orderId)],
);

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
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shipments_tenant_number_unique").on(t.tenantId, t.number),
    index("shipments_tenant_idx").on(t.tenantId),
    index("shipments_status_idx").on(t.tenantId, t.status),
    index("shipments_customer_idx").on(t.tenantId, t.customerId),
  ],
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
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("items_tenant_sku_unique").on(t.tenantId, t.sku),
    index("items_tenant_idx").on(t.tenantId),
  ],
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
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_movements_item_idx").on(t.tenantId, t.itemId),
    index("stock_movements_warehouse_idx").on(t.tenantId, t.warehouseId),
    index("stock_movements_tenant_idx").on(t.tenantId, t.createdAt),
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

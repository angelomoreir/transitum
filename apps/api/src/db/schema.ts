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
    // Email globalmente Ãºnico â€” permite login sem selecionar empresa
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

// ---- Fase 2: parceiros, encomendas, expedições ----

/** Numeração sequencial por tenant (ENC-00001, EXP-00001, CLI-0001…). */
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
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shipment_events_shipment_idx").on(t.shipmentId, t.occurredAt),
    index("shipment_events_tenant_idx").on(t.tenantId),
  ],
);

CREATE TYPE "public"."order_status" AS ENUM('draft', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."partner_type" AS ENUM('customer', 'supplier', 'carrier');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('draft', 'planned', 'in_transit', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"description" varchar(200) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"weight_kg" double precision
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" varchar(24) NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"requested_date" date,
	"notes" text,
	"delivery_line1" varchar(160),
	"delivery_city" varchar(80),
	"delivery_postal_code" varchar(16),
	"delivery_country" varchar(2),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(24) NOT NULL,
	"types" "partner_type"[] NOT NULL,
	"name" varchar(160) NOT NULL,
	"tax_id" varchar(32),
	"email" varchar(254),
	"phone" varchar(32),
	"address_line1" varchar(160),
	"city" varchar(80),
	"postal_code" varchar(16),
	"country" varchar(2) DEFAULT 'PT' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"tenant_id" uuid NOT NULL,
	"key" varchar(32) NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sequences_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "shipment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"status" "shipment_status",
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" varchar(24) NOT NULL,
	"order_id" uuid,
	"customer_id" uuid NOT NULL,
	"carrier_id" uuid,
	"status" "shipment_status" DEFAULT 'draft' NOT NULL,
	"pickup_line1" varchar(160) NOT NULL,
	"pickup_city" varchar(80) NOT NULL,
	"pickup_postal_code" varchar(16) NOT NULL,
	"pickup_country" varchar(2) NOT NULL,
	"delivery_line1" varchar(160) NOT NULL,
	"delivery_city" varchar(80) NOT NULL,
	"delivery_postal_code" varchar(16) NOT NULL,
	"delivery_country" varchar(2) NOT NULL,
	"planned_pickup_at" timestamp with time zone,
	"planned_delivery_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"total_weight_kg" double precision,
	"packages" integer,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_partners_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customer_id_partners_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrier_id_partners_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_number_unique" ON "orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "orders_tenant_idx" ON "orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_tenant_code_unique" ON "partners" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "partners_tenant_idx" ON "partners" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "partners_name_idx" ON "partners" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "shipment_events_shipment_idx" ON "shipment_events" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "shipment_events_tenant_idx" ON "shipment_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_tenant_number_unique" ON "shipments" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "shipments_tenant_idx" ON "shipments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "shipments_customer_idx" ON "shipments" USING btree ("tenant_id","customer_id");
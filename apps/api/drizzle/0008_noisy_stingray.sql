CREATE TYPE "public"."transport_doc_status" AS ENUM('issued', 'communicated', 'failed');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'driver';--> statement-breakpoint
CREATE TABLE "at_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"environment" varchar(12) DEFAULT 'test' NOT NULL,
	"username" varchar(40),
	"password_enc" text,
	"doc_type" varchar(2) DEFAULT 'GT' NOT NULL,
	"series" varchar(20) DEFAULT 'A' NOT NULL,
	"series_validation_code" varchar(20),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"provider" varchar(16) NOT NULL,
	"mode" varchar(12) DEFAULT 'sandbox' NOT NULL,
	"credentials_enc" text,
	"config" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"key" varchar(300) PRIMARY KEY NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proofs_of_delivery" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"stop_id" uuid NOT NULL,
	"shipment_id" uuid,
	"recipient_name" varchar(120) NOT NULL,
	"signature_doc_id" uuid,
	"photo_doc_id" uuid,
	"lat" double precision,
	"lng" double precision,
	"note" varchar(300),
	"captured_by" uuid,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_positions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"user_id" uuid,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" double precision,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_line_id" uuid,
	"item_id" uuid,
	"line_no" integer NOT NULL,
	"description" varchar(200) NOT NULL,
	"quantity" integer NOT NULL,
	"unit" varchar(12) DEFAULT 'UN' NOT NULL,
	"weight_kg" double precision,
	"unit_price" double precision
);
--> statement-breakpoint
CREATE TABLE "transport_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"doc_type" varchar(2) NOT NULL,
	"series" varchar(20) NOT NULL,
	"seq" integer NOT NULL,
	"number" varchar(60) NOT NULL,
	"atcud" varchar(60) NOT NULL,
	"movement_start_at" timestamp with time zone NOT NULL,
	"vehicle_ref" varchar(40),
	"hash" text,
	"hash_control" varchar(40),
	"status" "transport_doc_status" DEFAULT 'issued' NOT NULL,
	"environment" varchar(12),
	"at_doc_code" varchar(40),
	"at_message" varchar(500),
	"communicated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "unit_price" double precision;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "reserved_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "shipped_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "route_stops" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "route_stops" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "driver_user_id" uuid;--> statement-breakpoint
ALTER TABLE "shipment_costs" ADD COLUMN "rate_id" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "recipient_name" varchar(120);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "recipient_email" varchar(254);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "recipient_phone" varchar(32);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "notify_recipient" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "tracking_token" varchar(40);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "pickup_lat" double precision;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "pickup_lng" double precision;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "delivery_lat" double precision;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "delivery_lng" double precision;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "distance_km" double precision;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "vehicle_ref" varchar(40);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "stock_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "carrier_provider" varchar(16);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "tracking_number" varchar(60);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "carrier_ref" varchar(80);--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "carrier_booked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "carrier_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tax_id" varchar(32);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_line1" varchar(160);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "city" varchar(80);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "postal_code" varchar(16);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "country" varchar(2) DEFAULT 'PT';--> statement-breakpoint
ALTER TABLE "at_settings" ADD CONSTRAINT "at_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_connections" ADD CONSTRAINT "carrier_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_connections" ADD CONSTRAINT "carrier_connections_carrier_id_partners_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_stop_id_route_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."route_stops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_signature_doc_id_documents_id_fk" FOREIGN KEY ("signature_doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_photo_doc_id_documents_id_fk" FOREIGN KEY ("photo_doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_positions" ADD CONSTRAINT "route_positions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_positions" ADD CONSTRAINT "route_positions_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_positions" ADD CONSTRAINT "route_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_documents" ADD CONSTRAINT "transport_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_documents" ADD CONSTRAINT "transport_documents_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_documents" ADD CONSTRAINT "transport_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_connections_carrier_unique" ON "carrier_connections" USING btree ("tenant_id","carrier_id");--> statement-breakpoint
CREATE INDEX "pod_shipment_idx" ON "proofs_of_delivery" USING btree ("tenant_id","shipment_id");--> statement-breakpoint
CREATE INDEX "pod_stop_idx" ON "proofs_of_delivery" USING btree ("stop_id");--> statement-breakpoint
CREATE INDEX "route_positions_route_idx" ON "route_positions" USING btree ("route_id","recorded_at");--> statement-breakpoint
CREATE INDEX "shipment_lines_shipment_idx" ON "shipment_lines" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_docs_series_seq_unique" ON "transport_documents" USING btree ("tenant_id","doc_type","series","seq");--> statement-breakpoint
CREATE INDEX "transport_docs_shipment_idx" ON "transport_documents" USING btree ("tenant_id","shipment_id");--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_driver_user_id_users_id_fk" FOREIGN KEY ("driver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_costs" ADD CONSTRAINT "shipment_costs_rate_id_carrier_rates_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."carrier_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_tracking_token_unique" ON "shipments" USING btree ("tracking_token");--> statement-breakpoint
CREATE INDEX "shipments_tracking_number_idx" ON "shipments" USING btree ("tracking_number");--> statement-breakpoint
UPDATE "shipments" SET "tracking_token" = md5(random()::text || "id"::text) WHERE "tracking_token" IS NULL;
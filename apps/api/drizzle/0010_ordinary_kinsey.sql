CREATE TYPE "carrier_invoice_status" AS ENUM('pending', 'matched', 'discrepancy');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "carrier_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"shipment_id" uuid,
	"invoice_number" varchar(60) NOT NULL,
	"amount" double precision NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"expected_amount" double precision,
	"variance" double precision,
	"status" "carrier_invoice_status" DEFAULT 'pending' NOT NULL,
	"issued_at" date,
	"note" varchar(300),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "carrier_invoices" ADD CONSTRAINT "carrier_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_invoices" ADD CONSTRAINT "carrier_invoices_carrier_id_partners_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_invoices" ADD CONSTRAINT "carrier_invoices_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_invoices" ADD CONSTRAINT "carrier_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carrier_invoices_tenant_idx" ON "carrier_invoices" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "carrier_invoices_carrier_idx" ON "carrier_invoices" USING btree ("tenant_id","carrier_id");--> statement-breakpoint
CREATE INDEX "carrier_invoices_shipment_idx" ON "carrier_invoices" USING btree ("shipment_id");--> statement-breakpoint
CREATE TYPE "count_status" AS ENUM('open', 'applied', 'cancelled');--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"number" varchar(24) NOT NULL,
	"status" "count_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"applied_by" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_counts_tenant_number_unique" UNIQUE("tenant_id","number")
);--> statement-breakpoint
CREATE TABLE "inventory_count_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"expected_qty" integer NOT NULL,
	"counted_qty" integer,
	CONSTRAINT "inventory_count_lines_count_item_unique" UNIQUE("count_id","item_id")
);--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_counts_tenant_idx" ON "inventory_counts" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_count_lines_count_idx" ON "inventory_count_lines" USING btree ("tenant_id","count_id");
-- Fase 13: localizações/bins, portal do cliente, intake EDI (external_ref), alertas de atraso
CREATE TABLE "warehouse_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"code" varchar(24) NOT NULL,
	"zone" varchar(40),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_pick_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "item_pick_locations" ADD CONSTRAINT "item_pick_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "item_pick_locations" ADD CONSTRAINT "item_pick_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "item_pick_locations" ADD CONSTRAINT "item_pick_locations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "item_pick_locations" ADD CONSTRAINT "item_pick_locations_location_id_warehouse_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "portal_token" varchar(48);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "external_ref" varchar(80);
--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "late_alerted_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "partners_portal_token_unique" ON "partners" USING btree ("portal_token");
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_external_unique" ON "orders" USING btree ("tenant_id","external_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_locations_unique" ON "warehouse_locations" USING btree ("tenant_id","warehouse_id","code");
--> statement-breakpoint
CREATE INDEX "warehouse_locations_wh_idx" ON "warehouse_locations" USING btree ("tenant_id","warehouse_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "item_pick_locations_unique" ON "item_pick_locations" USING btree ("tenant_id","warehouse_id","item_id");

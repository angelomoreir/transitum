CREATE TYPE "public"."cost_type" AS ENUM('freight', 'fuel', 'tolls', 'other');--> statement-breakpoint
CREATE TYPE "public"."rate_basis" AS ENUM('flat', 'per_kg', 'per_km', 'per_package');--> statement-breakpoint
CREATE TYPE "public"."route_status" AS ENUM('draft', 'dispatched', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."stop_status" AS ENUM('pending', 'arrived', 'done', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."stop_type" AS ENUM('pickup', 'delivery');--> statement-breakpoint
CREATE TABLE "carrier_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"basis" "rate_basis" NOT NULL,
	"price" double precision NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"min_charge" double precision,
	"valid_from" date,
	"valid_to" date,
	"active" boolean DEFAULT true NOT NULL,
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_stops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"shipment_id" uuid,
	"seq" integer NOT NULL,
	"type" "stop_type" NOT NULL,
	"status" "stop_status" DEFAULT 'pending' NOT NULL,
	"address_line1" varchar(160) NOT NULL,
	"city" varchar(80) NOT NULL,
	"postal_code" varchar(16) NOT NULL,
	"country" varchar(2) NOT NULL,
	"planned_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"note" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" varchar(24) NOT NULL,
	"name" varchar(160) NOT NULL,
	"carrier_id" uuid,
	"driver_name" varchar(120),
	"vehicle_ref" varchar(40),
	"status" "route_status" DEFAULT 'draft' NOT NULL,
	"planned_start_at" timestamp with time zone,
	"planned_end_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_costs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"type" "cost_type" NOT NULL,
	"description" varchar(200) NOT NULL,
	"amount" double precision NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipment_events" ADD COLUMN "location" varchar(160);--> statement-breakpoint
ALTER TABLE "carrier_rates" ADD CONSTRAINT "carrier_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_rates" ADD CONSTRAINT "carrier_rates_carrier_id_partners_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_carrier_id_partners_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_costs" ADD CONSTRAINT "shipment_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_costs" ADD CONSTRAINT "shipment_costs_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_costs" ADD CONSTRAINT "shipment_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carrier_rates_tenant_idx" ON "carrier_rates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "carrier_rates_carrier_idx" ON "carrier_rates" USING btree ("tenant_id","carrier_id");--> statement-breakpoint
CREATE INDEX "route_stops_route_idx" ON "route_stops" USING btree ("route_id","seq");--> statement-breakpoint
CREATE INDEX "route_stops_tenant_idx" ON "route_stops" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "route_stops_shipment_idx" ON "route_stops" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_tenant_number_unique" ON "routes" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "routes_tenant_idx" ON "routes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "routes_status_idx" ON "routes" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "shipment_costs_shipment_idx" ON "shipment_costs" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_costs_tenant_idx" ON "shipment_costs" USING btree ("tenant_id");
-- Fase 16: IVA/fiscalidade nas faturas, waves persistidas, SSO/OIDC, EDI EDIFACT, séries em contagens
ALTER TYPE "webhook_source" ADD VALUE 'edifact';
--> statement-breakpoint
CREATE TYPE "pick_wave_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN "tax_rate" double precision DEFAULT 23 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN "tax_amount" double precision DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "series" varchar(8) DEFAULT 'FT' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "seq" integer;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "atcud" varchar(80);
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "hash" text;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "hash_control" varchar(20);
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "at_status" varchar(20);
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "at_message" varchar(500);
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "subtotal" double precision DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "tax_total" double precision DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Preenche a sequência das faturas existentes a partir do sufixo do número
UPDATE "sales_invoices" SET "seq" = substring(number from '-(\d+)$')::int WHERE "seq" IS NULL;
--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD COLUMN "counted_serials" text;
--> statement-breakpoint
CREATE TABLE "pick_waves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" varchar(24) NOT NULL,
	"status" "pick_wave_status" DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"created_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pick_wave_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"wave_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"item_id" uuid,
	"sku" varchar(60),
	"item_name" varchar(200) NOT NULL,
	"location" varchar(80),
	"quantity" integer NOT NULL,
	"picked_qty" integer DEFAULT 0 NOT NULL,
	"picked_at" timestamp with time zone,
	"picked_by" uuid
);
--> statement-breakpoint
CREATE TABLE "sso_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"domain" varchar(160) NOT NULL,
	"client_id" varchar(300) NOT NULL,
	"client_secret_enc" text NOT NULL,
	"authorize_url" varchar(500) NOT NULL,
	"token_url" varchar(500) NOT NULL,
	"userinfo_url" varchar(500),
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_provision" boolean DEFAULT false NOT NULL,
	"default_role" "role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_states" (
	"state" varchar(80) PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"nonce" varchar(80) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pick_waves" ADD CONSTRAINT "pick_waves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pick_waves" ADD CONSTRAINT "pick_waves_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pick_waves" ADD CONSTRAINT "pick_waves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pick_wave_lines" ADD CONSTRAINT "pick_wave_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pick_wave_lines" ADD CONSTRAINT "pick_wave_lines_wave_id_pick_waves_id_fk" FOREIGN KEY ("wave_id") REFERENCES "public"."pick_waves"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pick_wave_lines" ADD CONSTRAINT "pick_wave_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pick_wave_lines" ADD CONSTRAINT "pick_wave_lines_order_line_id_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."order_lines"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pick_wave_lines" ADD CONSTRAINT "pick_wave_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pick_wave_lines" ADD CONSTRAINT "pick_wave_lines_picked_by_users_id_fk" FOREIGN KEY ("picked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sso_providers" ADD CONSTRAINT "sso_providers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sso_states" ADD CONSTRAINT "sso_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sso_states" ADD CONSTRAINT "sso_states_provider_id_sso_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sso_providers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "pick_waves_tenant_number_unique" ON "pick_waves" USING btree ("tenant_id","number");
--> statement-breakpoint
CREATE INDEX "pick_waves_tenant_idx" ON "pick_waves" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "pick_waves_assignee_idx" ON "pick_waves" USING btree ("assigned_to");
--> statement-breakpoint
CREATE UNIQUE INDEX "pick_wave_lines_wave_line_unique" ON "pick_wave_lines" USING btree ("wave_id","order_line_id");
--> statement-breakpoint
CREATE INDEX "pick_wave_lines_wave_idx" ON "pick_wave_lines" USING btree ("tenant_id","wave_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sso_providers_tenant_domain_unique" ON "sso_providers" USING btree ("tenant_id","domain");
--> statement-breakpoint
CREATE INDEX "sso_providers_domain_idx" ON "sso_providers" USING btree ("domain");
--> statement-breakpoint
CREATE INDEX "sales_invoices_series_idx" ON "sales_invoices" USING btree ("tenant_id","series","seq");

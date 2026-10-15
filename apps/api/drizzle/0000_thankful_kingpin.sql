CREATE TYPE "public"."auth_token_type" AS ENUM('invite', 'reset');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'manager', 'operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" varchar(80) NOT NULL,
	"entity" varchar(60),
	"entity_id" uuid,
	"metadata" jsonb,
	"ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "auth_token_type" NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"ip" varchar(45),
	"user_agent" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"plan" varchar(32) DEFAULT 'trial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"name" varchar(120) NOT NULL,
	"password_hash" text,
	"role" "role" DEFAULT 'operator' NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_tenant_created_idx" ON "audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_unique" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_unique" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_tenant_idx" ON "refresh_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");
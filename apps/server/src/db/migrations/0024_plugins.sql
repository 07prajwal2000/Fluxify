CREATE TYPE "public"."plugin_approval" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."plugin_source" AS ENUM('upload', 'npm', 'url', 'fs');--> statement-breakpoint
CREATE TYPE "public"."plugin_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"name" varchar(214) NOT NULL,
	"version" varchar(64) NOT NULL,
	"source" "plugin_source" NOT NULL,
	"location" text NOT NULL,
	"integrity" text NOT NULL,
	"url" text NOT NULL,
	"sdk_range" varchar(64) NOT NULL,
	"manifest" jsonb NOT NULL,
	"approval" "plugin_approval" DEFAULT 'pending' NOT NULL,
	"approved_by" varchar(50),
	"approved_at" timestamp,
	"permissions" jsonb,
	"dev_enabled" boolean DEFAULT true NOT NULL,
	"prod_enabled" boolean DEFAULT false NOT NULL,
	"status" "plugin_status" DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"scanned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_plugins_project_name" ON "plugins" USING btree ("project_id","name");
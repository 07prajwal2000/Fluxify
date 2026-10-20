CREATE TYPE "public"."plugin_url_status" AS ENUM('awaiting_fetch', 'fetched', 'failed');--> statement-breakpoint
ALTER TYPE "public"."instance_setting_category" ADD VALUE 'plugins';--> statement-breakpoint
CREATE TABLE "plugin_url_requests" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"url" text NOT NULL,
	"status" "plugin_url_status" DEFAULT 'awaiting_fetch' NOT NULL,
	"requested_by" varchar(50) NOT NULL,
	"fetched_by" varchar(50),
	"plugin_name" varchar(214),
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plugin_url_requests" ADD CONSTRAINT "plugin_url_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
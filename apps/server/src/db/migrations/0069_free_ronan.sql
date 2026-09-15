CREATE TYPE "public"."system_log_level" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TABLE "system_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" varchar(50),
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(50) NOT NULL,
	"type" varchar(50) NOT NULL,
	"level" "system_log_level" NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_system_logs_resource" ON "system_logs" USING btree ("type","resource_id","resource_type");--> statement-breakpoint
CREATE INDEX "idx_system_logs_project_id" ON "system_logs" USING btree ("project_id","updated_at");
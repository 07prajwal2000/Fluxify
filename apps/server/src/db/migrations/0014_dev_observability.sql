CREATE TYPE "public"."fluxify_env" AS ENUM('production', 'development');--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "dev_tracing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "dev_record_execution" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "trace_runs" ADD COLUMN "env" "fluxify_env" DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "dev_tracing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "dev_record_execution" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- sandbox runs only ever come from a development worker
UPDATE "trace_runs" SET "env" = 'development' WHERE "sandbox_id" IS NOT NULL;
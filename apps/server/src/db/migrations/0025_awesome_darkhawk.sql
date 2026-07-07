ALTER TABLE "routes" ADD COLUMN "body_schema" jsonb;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "query_schema" jsonb;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "params_schema" jsonb;
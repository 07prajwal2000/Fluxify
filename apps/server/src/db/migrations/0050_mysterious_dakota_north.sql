ALTER TABLE "routes" ADD COLUMN "tracing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "record_execution" boolean DEFAULT false NOT NULL;
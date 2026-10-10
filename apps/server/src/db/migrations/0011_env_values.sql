ALTER TABLE "app_config" ADD COLUMN "dev_value" text;--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "sync_dev" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "dev_config" jsonb;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "sync_dev" boolean DEFAULT false NOT NULL;
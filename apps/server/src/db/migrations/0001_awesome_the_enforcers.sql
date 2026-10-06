ALTER TABLE "custom_blocks_list" ADD COLUMN "canvas_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "canvas_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "canvas_version" integer DEFAULT 0 NOT NULL;
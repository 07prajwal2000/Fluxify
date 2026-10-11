ALTER TABLE "routes" RENAME COLUMN "canvas_version" TO "canvas_revision";--> statement-breakpoint
ALTER TABLE "workflows" RENAME COLUMN "canvas_version" TO "canvas_revision";--> statement-breakpoint
ALTER TABLE "custom_blocks_list" RENAME COLUMN "canvas_version" TO "canvas_revision";--> statement-breakpoint
ALTER TABLE "sandboxes" RENAME COLUMN "canvas_version" TO "canvas_revision";--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "dev_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "dev_active" boolean DEFAULT true NOT NULL;

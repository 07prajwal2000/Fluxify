CREATE TYPE "public"."app_config_data_types" AS ENUM('string', 'number', 'boolean');--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "id" SET DEFAULT '019bc2e7-9c0d-7aed-ae39-fe804a4901f9';--> statement-breakpoint
ALTER TABLE "edges" ALTER COLUMN "id" SET DEFAULT '019bc2e7-9c0d-7aed-ae39-fe819d3da097';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "id" SET DEFAULT '019bc2e7-9c0c-7a7a-8d4d-d989cdbb0524';--> statement-breakpoint
ALTER TABLE "routes" ALTER COLUMN "id" SET DEFAULT '019bc2e7-9c0d-7aed-ae39-fe7fe04d230d';--> statement-breakpoint
ALTER TABLE "app_config" ADD COLUMN "data_type" "app_config_data_types" DEFAULT 'string';
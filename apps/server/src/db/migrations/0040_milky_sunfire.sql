CREATE TYPE "public"."instance_setting_category" AS ENUM('auth');--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"category" "instance_setting_category" NOT NULL,
	"value" jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_key_unique" UNIQUE("key")
);

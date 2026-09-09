ALTER TABLE "triggers" ADD COLUMN "schedule" varchar(255);--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "timezone" varchar(64) DEFAULT 'UTC' NOT NULL;
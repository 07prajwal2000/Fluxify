ALTER TABLE "triggers" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "commit_mode" varchar(10) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "retry_delay_ms" integer DEFAULT 1000 NOT NULL;
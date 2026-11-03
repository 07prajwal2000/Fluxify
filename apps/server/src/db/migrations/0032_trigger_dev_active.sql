ALTER TABLE "triggers" ADD COLUMN "dev_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- existing triggers keep running where they ran: development follows the one switch they had (#1072)
UPDATE "triggers" SET "dev_active" = "active";
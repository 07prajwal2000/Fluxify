ALTER TABLE "agent_harness_conversations" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_harness_conversations" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_harness_conv_user_archived_pinned" ON "agent_harness_conversations" USING btree ("user_id","archived","pinned");
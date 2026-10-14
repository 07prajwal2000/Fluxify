ALTER TABLE "agent_conversations" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
-- already-archived chats get the full retention window from the upgrade, not a delete on the first tick
UPDATE "agent_conversations" SET "archived_at" = now() WHERE "archived" = true;
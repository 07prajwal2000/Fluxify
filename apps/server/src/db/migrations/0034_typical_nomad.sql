ALTER TABLE "ai_chat_conversations" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ai_chat_conversations" ALTER COLUMN "status" SET DEFAULT 'not_started'::text;--> statement-breakpoint
ALTER TABLE "ai_chat_history" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "ai_chat_history" ALTER COLUMN "status" SET DEFAULT 'running'::text;--> statement-breakpoint
DROP TYPE "public"."ai_chat_conversation_status";--> statement-breakpoint
CREATE TYPE "public"."ai_chat_conversation_status" AS ENUM('not_started', 'running', 'success', 'error', 'paused', 'plan_rejected');--> statement-breakpoint
ALTER TABLE "ai_chat_conversations" ALTER COLUMN "status" SET DEFAULT 'not_started'::"public"."ai_chat_conversation_status";--> statement-breakpoint
ALTER TABLE "ai_chat_conversations" ALTER COLUMN "status" SET DATA TYPE "public"."ai_chat_conversation_status" USING "status"::"public"."ai_chat_conversation_status";--> statement-breakpoint
ALTER TABLE "ai_chat_history" ALTER COLUMN "status" SET DEFAULT 'running'::"public"."ai_chat_conversation_status";--> statement-breakpoint
ALTER TABLE "ai_chat_history" ALTER COLUMN "status" SET DATA TYPE "public"."ai_chat_conversation_status" USING "status"::"public"."ai_chat_conversation_status";
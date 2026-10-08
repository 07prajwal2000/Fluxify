CREATE TYPE "public"."agent_message_role" AS ENUM('user', 'assistant', 'tool', 'summary');--> statement-breakpoint
ALTER TYPE "public"."agent_harness_run_status" ADD VALUE 'waiting_approval';--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"run_id" varchar(50) NOT NULL,
	"seq" integer NOT NULL,
	"role" "agent_message_role" NOT NULL,
	"content" jsonb NOT NULL,
	"tokens" integer,
	"covers_up_to_seq" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_messages_conv_seq" ON "agent_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "idx_agent_messages_run_id" ON "agent_messages" USING btree ("run_id");
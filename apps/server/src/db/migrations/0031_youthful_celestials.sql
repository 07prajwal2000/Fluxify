CREATE TYPE "public"."ai_workflow_builder_step_status" AS ENUM('running', 'completed', 'failed', 'paused', 'awaiting_review');--> statement-breakpoint
CREATE TYPE "public"."ai_workflow_builder_step_type" AS ENUM('verify', 'planner', 'orchestrator', 'sub_agent', 'evaluator');--> statement-breakpoint
CREATE TABLE "ai_workflow_builder_steps" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"chat_history_id" varchar(50) NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"step_type" "ai_workflow_builder_step_type" NOT NULL,
	"step_status" "ai_workflow_builder_step_status" DEFAULT 'running' NOT NULL,
	"step_order" serial NOT NULL,
	"input_data" jsonb,
	"output_data" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_workflow_builder_steps" ADD CONSTRAINT "ai_workflow_builder_steps_chat_history_id_ai_chat_history_id_fk" FOREIGN KEY ("chat_history_id") REFERENCES "public"."ai_chat_history"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_workflow_builder_steps" ADD CONSTRAINT "ai_workflow_builder_steps_conversation_id_ai_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_wf_steps_chat_history_id" ON "ai_workflow_builder_steps" USING btree ("chat_history_id");--> statement-breakpoint
CREATE INDEX "idx_ai_wf_steps_conversation_id" ON "ai_workflow_builder_steps" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_ai_wf_steps_step_type" ON "ai_workflow_builder_steps" USING btree ("step_type");--> statement-breakpoint
CREATE INDEX "idx_ai_wf_steps_step_status" ON "ai_workflow_builder_steps" USING btree ("step_status");
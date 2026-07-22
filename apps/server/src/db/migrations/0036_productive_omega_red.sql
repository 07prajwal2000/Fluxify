CREATE TYPE "public"."agent_harness_conversation_status" AS ENUM('idle', 'running', 'paused_hitl', 'interrupted', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agent_harness_hitl_action_type" AS ENUM('plan_approval', 'plan_rejection', 'user_input', 'confirmation', 'cancellation', 'custom');--> statement-breakpoint
CREATE TYPE "public"."agent_harness_live_state_status" AS ENUM('running', 'paused_hitl', 'interrupted', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agent_harness_run_status" AS ENUM('queued', 'routing', 'verifying', 'planning', 'orchestrating', 'executing', 'awaiting_hitl', 'completed', 'interrupted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."agent_harness_step_status" AS ENUM('pending', 'running', 'completed', 'failed', 'interrupted');--> statement-breakpoint
CREATE TABLE "agent_harness_artifacts" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"run_id" varchar(50) NOT NULL,
	"raw_artifact" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_harness_conversations" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50),
	"project_id" varchar(50),
	"title" varchar(255) DEFAULT 'New Chat',
	"status" "agent_harness_conversation_status" DEFAULT 'idle' NOT NULL,
	"active_run_id" varchar(50),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_harness_hitl_actions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"run_id" varchar(50) NOT NULL,
	"step_id" varchar(50),
	"action_type" "agent_harness_hitl_action_type" NOT NULL,
	"user_response" jsonb,
	"performed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_harness_live_states" (
	"run_id" varchar(50) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"current_state" "agent_harness_live_state_status" DEFAULT 'running' NOT NULL,
	"active_step_id" varchar(50),
	"working_memory" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_harness_runs" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"user_query" text NOT NULL,
	"ai_response" text,
	"status" "agent_harness_run_status" DEFAULT 'queued' NOT NULL,
	"interrupted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_harness_steps" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"run_id" varchar(50) NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"step_type" varchar(100) NOT NULL,
	"step_order" serial NOT NULL,
	"sub_agent_role" varchar(100),
	"sub_agent_id" varchar(100),
	"status" "agent_harness_step_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_harness_artifacts" ADD CONSTRAINT "agent_harness_artifacts_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_artifacts" ADD CONSTRAINT "agent_harness_artifacts_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_conversations" ADD CONSTRAINT "agent_harness_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_conversations" ADD CONSTRAINT "agent_harness_conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_hitl_actions" ADD CONSTRAINT "agent_harness_hitl_actions_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_hitl_actions" ADD CONSTRAINT "agent_harness_hitl_actions_step_id_agent_harness_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."agent_harness_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_live_states" ADD CONSTRAINT "agent_harness_live_states_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_live_states" ADD CONSTRAINT "agent_harness_live_states_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_runs" ADD CONSTRAINT "agent_harness_runs_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_steps" ADD CONSTRAINT "agent_harness_steps_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_steps" ADD CONSTRAINT "agent_harness_steps_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_harness_artifacts_conv_id" ON "agent_harness_artifacts" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_harness_artifacts_run_id" ON "agent_harness_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_harness_conv_user_id" ON "agent_harness_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_harness_conv_project_id" ON "agent_harness_conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_harness_hitl_run_id" ON "agent_harness_hitl_actions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_harness_hitl_step_id" ON "agent_harness_hitl_actions" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "idx_harness_live_conv_id" ON "agent_harness_live_states" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_harness_runs_conv_id" ON "agent_harness_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_harness_runs_status" ON "agent_harness_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_harness_steps_run_id" ON "agent_harness_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_harness_steps_sub_agent_id" ON "agent_harness_steps" USING btree ("sub_agent_id");
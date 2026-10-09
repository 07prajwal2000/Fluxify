ALTER TABLE "agent_harness_conversations" RENAME TO "agent_conversations";--> statement-breakpoint
ALTER TABLE "agent_harness_runs" RENAME TO "agent_runs";--> statement-breakpoint
ALTER TYPE "public"."agent_harness_conversation_status" RENAME TO "agent_conversation_status";--> statement-breakpoint
ALTER TYPE "public"."agent_harness_run_status" RENAME TO "agent_run_status";--> statement-breakpoint
ALTER TABLE "agent_conversations" RENAME CONSTRAINT "agent_harness_conversations_pkey" TO "agent_conversations_pkey";--> statement-breakpoint
ALTER TABLE "agent_runs" RENAME CONSTRAINT "agent_harness_runs_pkey" TO "agent_runs_pkey";--> statement-breakpoint
ALTER TABLE "agent_conversations" RENAME CONSTRAINT "agent_harness_conversations_user_id_system_users_id_fk" TO "agent_conversations_user_id_system_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_conversations" RENAME CONSTRAINT "agent_harness_conversations_project_id_projects_id_fk" TO "agent_conversations_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "agent_runs" RENAME CONSTRAINT "agent_harness_runs_conversation_id_agent_harness_conversations_id_fk" TO "agent_runs_conversation_id_agent_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "agent_runs" RENAME CONSTRAINT "agent_harness_runs_integration_id_integrations_id_fk" TO "agent_runs_integration_id_integrations_id_fk";--> statement-breakpoint
ALTER TABLE "agent_messages" RENAME CONSTRAINT "agent_messages_conversation_id_agent_harness_conversations_id_fk" TO "agent_messages_conversation_id_agent_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "agent_messages" RENAME CONSTRAINT "agent_messages_run_id_agent_harness_runs_id_fk" TO "agent_messages_run_id_agent_runs_id_fk";--> statement-breakpoint
ALTER INDEX "idx_harness_conv_user_id" RENAME TO "idx_agent_conv_user_id";--> statement-breakpoint
ALTER INDEX "idx_harness_conv_project_id" RENAME TO "idx_agent_conv_project_id";--> statement-breakpoint
ALTER INDEX "idx_harness_conv_user_archived_pinned" RENAME TO "idx_agent_conv_user_archived_pinned";--> statement-breakpoint
ALTER INDEX "idx_harness_runs_conv_id" RENAME TO "idx_agent_runs_conv_id";--> statement-breakpoint
ALTER INDEX "idx_harness_runs_status" RENAME TO "idx_agent_runs_status";--> statement-breakpoint
ALTER INDEX "idx_harness_runs_integration_id" RENAME TO "idx_agent_runs_integration_id";

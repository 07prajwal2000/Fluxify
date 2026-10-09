-- Drop the old AI harness: its conversations (and, by cascade, their runs) go;
-- the new agent's are tagged metadata.agent = true and stay.
DELETE FROM "agent_harness_conversations" WHERE COALESCE("metadata"->>'agent', '') <> 'true';--> statement-breakpoint
DROP TABLE "agent_harness_artifacts" CASCADE;--> statement-breakpoint
DROP TABLE "agent_harness_compactions" CASCADE;--> statement-breakpoint
DROP TABLE "agent_harness_hitl_actions" CASCADE;--> statement-breakpoint
DROP TABLE "agent_harness_live_states" CASCADE;--> statement-breakpoint
DROP TABLE "agent_harness_steps" CASCADE;--> statement-breakpoint
DROP TABLE "agent_harness_sub_artifacts" CASCADE;--> statement-breakpoint
DROP TYPE "public"."agent_harness_hitl_action_type";--> statement-breakpoint
DROP TYPE "public"."agent_harness_live_state_status";--> statement-breakpoint
DROP TYPE "public"."agent_harness_step_status";

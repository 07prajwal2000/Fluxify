CREATE TABLE "agent_harness_sub_artifacts" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"artifact_id" varchar(50) NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"run_id" varchar(50) NOT NULL,
	"sub_agent_id" varchar(100),
	"kind" varchar(50) NOT NULL,
	"action" varchar(50),
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_harness_artifacts" RENAME COLUMN "raw_artifact" TO "summary_markdown";--> statement-breakpoint
ALTER TABLE "agent_harness_sub_artifacts" ADD CONSTRAINT "agent_harness_sub_artifacts_artifact_id_agent_harness_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."agent_harness_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_sub_artifacts" ADD CONSTRAINT "agent_harness_sub_artifacts_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_sub_artifacts" ADD CONSTRAINT "agent_harness_sub_artifacts_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_harness_sub_artifacts_artifact_id" ON "agent_harness_sub_artifacts" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "idx_harness_sub_artifacts_run_id" ON "agent_harness_sub_artifacts" USING btree ("run_id");
CREATE TABLE "agent_harness_compactions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"conversation_id" varchar(50) NOT NULL,
	"summary" text NOT NULL,
	"source_run_ids" jsonb NOT NULL,
	"source_start_run_id" varchar(50) NOT NULL,
	"source_end_run_id" varchar(50) NOT NULL,
	"source_digest" varchar(64) NOT NULL,
	"source_input_tokens" integer NOT NULL,
	"source_output_tokens" integer NOT NULL,
	"compaction_input_tokens" integer NOT NULL,
	"compaction_output_tokens" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_harness_compactions" ADD CONSTRAINT "agent_harness_compactions_conversation_id_agent_harness_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_harness_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_compactions" ADD CONSTRAINT "agent_harness_compactions_source_start_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("source_start_run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_compactions" ADD CONSTRAINT "agent_harness_compactions_source_end_run_id_agent_harness_runs_id_fk" FOREIGN KEY ("source_end_run_id") REFERENCES "public"."agent_harness_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_harness_compactions_conv_source_end" ON "agent_harness_compactions" USING btree ("conversation_id","source_end_run_id");--> statement-breakpoint
CREATE INDEX "idx_harness_compactions_conv_created" ON "agent_harness_compactions" USING btree ("conversation_id","created_at");
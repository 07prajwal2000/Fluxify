CREATE TABLE "sandboxes" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"user_id" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"settings" jsonb DEFAULT '{"tracingEnabled":false}'::jsonb NOT NULL,
	"canvas_version" integer DEFAULT 0 NOT NULL,
	"block_key_counters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trace_runs" DROP CONSTRAINT "trace_runs_one_target";--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "sandbox_id" varchar(50);--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "sandbox_id" varchar(50);--> statement-breakpoint
ALTER TABLE "trace_runs" ADD COLUMN "sandbox_id" varchar(50);--> statement-breakpoint
ALTER TABLE "triggers" ADD COLUMN "sandbox_id" varchar(50);--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_user_id_system_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sandboxes_project_user" ON "sandboxes" USING btree ("project_id","user_id");--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_runs" ADD CONSTRAINT "trace_runs_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_sandbox_id_sandboxes_id_fk" FOREIGN KEY ("sandbox_id") REFERENCES "public"."sandboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_blocks_sandbox_id" ON "blocks" USING btree ("sandbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_blocks_sandbox_key" ON "blocks" USING btree ("sandbox_id","key");--> statement-breakpoint
CREATE INDEX "idx_edges_sandbox_id" ON "edges" USING btree ("sandbox_id");--> statement-breakpoint
CREATE INDEX "idx_trace_runs_project_sandbox" ON "trace_runs" USING btree ("project_id","sandbox_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_triggers_sandbox_id" ON "triggers" USING btree ("sandbox_id");--> statement-breakpoint
-- a block or edge with no parent is on no canvas and can never run; the checks below would refuse it
DELETE FROM "edges" WHERE num_nonnulls("route_id", "custom_block_id", "workflow_id") = 0;--> statement-breakpoint
DELETE FROM "blocks" WHERE num_nonnulls("route_id", "custom_block_id", "workflow_id") = 0;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_one_parent" CHECK (num_nonnulls("blocks"."route_id", "blocks"."custom_block_id", "blocks"."workflow_id", "blocks"."sandbox_id") = 1);--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_one_parent" CHECK (num_nonnulls("edges"."route_id", "edges"."custom_block_id", "edges"."workflow_id", "edges"."sandbox_id") = 1);--> statement-breakpoint
ALTER TABLE "trace_runs" ADD CONSTRAINT "trace_runs_one_target" CHECK (num_nonnulls("trace_runs"."route_id", "trace_runs"."workflow_id", "trace_runs"."sandbox_id") = 1);--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_one_target" CHECK (num_nonnulls("triggers"."workflow_id", "triggers"."sandbox_id") <= 1);
CREATE TYPE "public"."trace_outcome" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "trace_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"route_id" varchar(50),
	"workflow_id" varchar(50),
	"route_version" varchar(50),
	"workflow_version" varchar(50),
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" "trace_outcome" NOT NULL,
	"status_code" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"dropped_spans" integer DEFAULT 0 NOT NULL,
	"parent_run_id" uuid,
	"parent_seq" integer,
	"span_count" integer NOT NULL,
	CONSTRAINT "trace_runs_one_target" CHECK (num_nonnulls("trace_runs"."route_id", "trace_runs"."workflow_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "trace_spans" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"parent_seq" integer,
	"block_id" text NOT NULL,
	"block_type" text NOT NULL,
	"block_name" text,
	"custom_block_id" varchar(50),
	"middleware" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"outcome" "trace_outcome" NOT NULL,
	"branch" "trace_outcome",
	"error" text,
	"input" jsonb,
	"output" jsonb,
	"truncated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "trace_spans_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
ALTER TABLE "trace_runs" ADD CONSTRAINT "trace_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_runs" ADD CONSTRAINT "trace_runs_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_runs" ADD CONSTRAINT "trace_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_spans" ADD CONSTRAINT "trace_spans_run_id_trace_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."trace_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trace_runs_project_route" ON "trace_runs" USING btree ("project_id","route_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_trace_runs_project_workflow" ON "trace_runs" USING btree ("project_id","workflow_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_trace_runs_started_at" ON "trace_runs" USING btree ("started_at");
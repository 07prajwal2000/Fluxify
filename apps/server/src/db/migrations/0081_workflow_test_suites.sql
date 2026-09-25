ALTER TABLE "test_runs" ALTER COLUMN "route_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "test_suite_runs" ALTER COLUMN "route_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "test_suites" ALTER COLUMN "route_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "workflow_id" varchar(50);--> statement-breakpoint
ALTER TABLE "test_suite_runs" ADD COLUMN "workflow_id" varchar(50);--> statement-breakpoint
ALTER TABLE "test_suites" ADD COLUMN "workflow_id" varchar(50);--> statement-breakpoint
ALTER TABLE "test_suites" ADD COLUMN "input" jsonb;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_suite_runs" ADD CONSTRAINT "test_suite_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_test_runs_project_workflow" ON "test_runs" USING btree ("project_id","workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_test_suites_workflow" ON "test_suites" USING btree ("workflow_id");--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_one_target" CHECK (num_nonnulls("test_runs"."route_id", "test_runs"."workflow_id") = 1);--> statement-breakpoint
ALTER TABLE "test_suite_runs" ADD CONSTRAINT "test_suite_runs_one_target" CHECK (num_nonnulls("test_suite_runs"."route_id", "test_suite_runs"."workflow_id") = 1);--> statement-breakpoint
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_one_target" CHECK (num_nonnulls("test_suites"."route_id", "test_suites"."workflow_id") = 1);
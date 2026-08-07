CREATE TYPE "public"."test_run_status" AS ENUM('queued', 'running', 'passed', 'failed', 'timeout', 'error');--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"route_id" varchar(50) NOT NULL,
	"status" "test_run_status" DEFAULT 'queued' NOT NULL,
	"total_suites" integer NOT NULL,
	"passed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"duration_ms" integer,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_suite_runs" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"test_run_id" varchar(50) NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"route_id" varchar(50) NOT NULL,
	"test_suite_id" varchar(50) NOT NULL,
	"status" "test_run_status" DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"duration_ms" integer,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_suite_runs" ADD CONSTRAINT "test_suite_runs_test_run_id_test_runs_id_fk" FOREIGN KEY ("test_run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_suite_runs" ADD CONSTRAINT "test_suite_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_suite_runs" ADD CONSTRAINT "test_suite_runs_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_test_runs_project_route" ON "test_runs" USING btree ("project_id","route_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_test_suite_runs_run" ON "test_suite_runs" USING btree ("test_run_id");--> statement-breakpoint
CREATE INDEX "idx_test_suite_runs_project" ON "test_suite_runs" USING btree ("project_id","created_at");
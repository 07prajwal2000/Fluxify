DROP INDEX "uq_system_logs_resource";--> statement-breakpoint
ALTER TABLE "system_logs" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "system_logs" ADD CONSTRAINT "system_logs_run_id_trace_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."trace_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_system_logs_run_id" ON "system_logs" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_system_logs_resource" ON "system_logs" USING btree ("type","resource_id","resource_type") WHERE "system_logs"."type" <> 'runtime';
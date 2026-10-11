ALTER TABLE "test_runs" ADD COLUMN "env" varchar(16) DEFAULT 'development' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "deployment_id" uuid;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;
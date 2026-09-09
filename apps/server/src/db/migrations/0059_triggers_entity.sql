CREATE TABLE "trigger_groups" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"project_id" varchar(50) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triggers" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" varchar(50) NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"workflow_id" varchar(50) NOT NULL,
	"group_id" varchar(50) NOT NULL,
	"integration_id" uuid,
	"batch_size" integer DEFAULT 1 NOT NULL,
	"max_wait_ms" integer DEFAULT 0 NOT NULL,
	"max_bytes" integer DEFAULT 1048576 NOT NULL,
	"concurrency" integer DEFAULT 1 NOT NULL,
	"payload" jsonb,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trigger_groups" ADD CONSTRAINT "trigger_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_group_id_trigger_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."trigger_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trigger_groups_project_id" ON "trigger_groups" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_trigger_groups_project_name" ON "trigger_groups" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "idx_triggers_project_id" ON "triggers" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_triggers_workflow_id" ON "triggers" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_triggers_group_id" ON "triggers" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "idx_triggers_integration_id" ON "triggers" USING btree ("integration_id");
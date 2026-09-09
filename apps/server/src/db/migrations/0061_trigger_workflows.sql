CREATE TABLE "trigger_workflows" (
	"trigger_id" varchar(50) NOT NULL,
	"workflow_id" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trigger_workflows_trigger_id_workflow_id_pk" PRIMARY KEY("trigger_id","workflow_id")
);
--> statement-breakpoint
ALTER TABLE "triggers" DROP CONSTRAINT "triggers_workflow_id_workflows_id_fk";
--> statement-breakpoint
DROP INDEX "idx_triggers_workflow_id";--> statement-breakpoint
ALTER TABLE "trigger_workflows" ADD CONSTRAINT "trigger_workflows_trigger_id_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."triggers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_workflows" ADD CONSTRAINT "trigger_workflows_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trigger_workflows_workflow_id" ON "trigger_workflows" USING btree ("workflow_id");--> statement-breakpoint
INSERT INTO "trigger_workflows" ("trigger_id", "workflow_id")
	SELECT "id", "workflow_id" FROM "triggers" WHERE "workflow_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "triggers" DROP COLUMN "workflow_id";

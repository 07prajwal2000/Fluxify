ALTER TABLE "triggers" ADD COLUMN "workflow_id" varchar(50);--> statement-breakpoint
-- A trigger starts one workflow now. Where one was linked to several, the
-- oldest link wins; the rest need a trigger of their own.
UPDATE "triggers" SET "workflow_id" = "links"."workflow_id"
	FROM (
		SELECT DISTINCT ON ("trigger_id") "trigger_id", "workflow_id"
		FROM "trigger_workflows"
		ORDER BY "trigger_id", "created_at", "workflow_id"
	) AS "links"
	WHERE "triggers"."id" = "links"."trigger_id";--> statement-breakpoint
DROP TABLE "trigger_workflows" CASCADE;--> statement-breakpoint
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_triggers_workflow_id" ON "triggers" USING btree ("workflow_id");

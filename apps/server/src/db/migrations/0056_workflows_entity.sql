CREATE TABLE "workflows" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"description" text,
	"active" boolean DEFAULT false,
	"project_id" varchar(50) DEFAULT NULL,
	"payload_schema" jsonb,
	"timeout_seconds" integer DEFAULT 300 NOT NULL,
	"tracing_enabled" boolean DEFAULT false NOT NULL,
	"record_execution" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workflows_project_id" ON "workflows" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_workflows_name_fts" ON "workflows" USING gin (to_tsvector('english', "name"));--> statement-breakpoint
--
-- Third canvas parent. The real foreign key has to exist before the generated
-- columns can read it, which is the one thing drizzle-kit gets wrong here: it
-- emits the column add last. Order below is deliberate, do not re-generate.
--
ALTER TABLE "blocks" ADD COLUMN "workflow_id" varchar(50);--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "workflow_id" varchar(50);--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_blocks_workflow_id" ON "blocks" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_edges_workflow_id" ON "edges" USING btree ("workflow_id");--> statement-breakpoint
--
-- A generated expression cannot be altered in place, so both columns are
-- dropped and rebuilt. That takes `idx_blocks_parent` / `idx_edges_parent` with
-- them — they are recreated at the bottom.
--
ALTER TABLE "blocks" drop column "parent_type";--> statement-breakpoint
ALTER TABLE "blocks" drop column "parent_id";--> statement-breakpoint
ALTER TABLE "edges" drop column "parent_type";--> statement-breakpoint
ALTER TABLE "edges" drop column "parent_id";--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "parent_type" varchar(20) GENERATED ALWAYS AS (CASE WHEN custom_block_id IS NOT NULL THEN 'custom_block' WHEN workflow_id IS NOT NULL THEN 'workflow' ELSE 'route' END) STORED;--> statement-breakpoint
ALTER TABLE "blocks" ADD COLUMN "parent_id" varchar(50) GENERATED ALWAYS AS (COALESCE(route_id, custom_block_id, workflow_id)) STORED;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "parent_type" varchar(20) GENERATED ALWAYS AS (CASE WHEN custom_block_id IS NOT NULL THEN 'custom_block' WHEN workflow_id IS NOT NULL THEN 'workflow' ELSE 'route' END) STORED;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "parent_id" varchar(50) GENERATED ALWAYS AS (COALESCE(route_id, custom_block_id, workflow_id)) STORED;--> statement-breakpoint
CREATE INDEX "idx_blocks_parent" ON "blocks" USING btree ("parent_type","parent_id");--> statement-breakpoint
CREATE INDEX "idx_edges_parent" ON "edges" USING btree ("parent_type","parent_id");

CREATE TABLE "canvas_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(16) NOT NULL,
	"route_id" varchar(50),
	"workflow_id" varchar(50),
	"project_id" varchar(50) NOT NULL,
	"version_number" integer NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"author_id" varchar(50),
	"author_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "canvas_versions_one_target" CHECK (("canvas_versions"."kind" = 'route' and "canvas_versions"."route_id" is not null and "canvas_versions"."workflow_id" is null)
				or ("canvas_versions"."kind" = 'workflow' and "canvas_versions"."workflow_id" is not null and "canvas_versions"."route_id" is null))
);
--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "committed_revision" integer;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "head_version_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "committed_revision" integer;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "head_version_id" uuid;--> statement-breakpoint
ALTER TABLE "canvas_versions" ADD CONSTRAINT "canvas_versions_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_versions" ADD CONSTRAINT "canvas_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_versions" ADD CONSTRAINT "canvas_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_versions" ADD CONSTRAINT "canvas_versions_parent_id_canvas_versions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."canvas_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_versions" ADD CONSTRAINT "canvas_versions_author_id_system_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."system_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_canvas_versions_route_number" ON "canvas_versions" USING btree ("route_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_canvas_versions_workflow_number" ON "canvas_versions" USING btree ("workflow_id","version_number");--> statement-breakpoint
CREATE INDEX "idx_canvas_versions_project_id" ON "canvas_versions" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_head_version_id_canvas_versions_id_fk" FOREIGN KEY ("head_version_id") REFERENCES "public"."canvas_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_head_version_id_canvas_versions_id_fk" FOREIGN KEY ("head_version_id") REFERENCES "public"."canvas_versions"("id") ON DELETE set null ON UPDATE no action;
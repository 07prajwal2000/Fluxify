CREATE TABLE "project_dependencies" (
	"project_id" varchar(50) PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"package_json" text NOT NULL,
	"lockfile" text NOT NULL,
	"updated_by" varchar(50),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_dependencies" ADD CONSTRAINT "project_dependencies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
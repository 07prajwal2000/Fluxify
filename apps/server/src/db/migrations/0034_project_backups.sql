CREATE TABLE "project_backups" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"type" varchar(20) NOT NULL,
	"mode" varchar(20) NOT NULL,
	"sections" jsonb NOT NULL,
	"format_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"release" varchar(100),
	"size_bytes" integer,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"error" text,
	"destination_key" text,
	"created_by" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "project_backups" ADD CONSTRAINT "project_backups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_backups" ADD CONSTRAINT "project_backups_created_by_system_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."system_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_backups_project_created" ON "project_backups" USING btree ("project_id","created_at");
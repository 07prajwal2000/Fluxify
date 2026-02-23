CREATE TABLE "project_settings" (
	"id" varchar(50) PRIMARY KEY DEFAULT '019c8c72-d401-7634-be9c-84d82e530358' NOT NULL,
	"project_id" varchar(50),
	"key" varchar(50) NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "id" SET DEFAULT '019c8c72-d402-7430-a834-7442da71af5b';--> statement-breakpoint
ALTER TABLE "edges" ALTER COLUMN "id" SET DEFAULT '019c8c72-d403-78db-ab4e-ffeb55614061';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "id" SET DEFAULT '019c8c72-d400-70e6-8711-0f24bd367459';--> statement-breakpoint
ALTER TABLE "routes" ALTER COLUMN "id" SET DEFAULT '019c8c72-d402-7430-a834-7441f5a619a3';--> statement-breakpoint
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_settings_project_id" ON "project_settings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_project_settings_key" ON "project_settings" USING btree ("key");
CREATE TABLE "agent_reviews" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"target_id" varchar(50) NOT NULL,
	"user_id" varchar(50),
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"canvas_revision" integer,
	"summary" text,
	"findings" jsonb,
	"error" text,
	"usage" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_reviews" ADD CONSTRAINT "agent_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_reviews" ADD CONSTRAINT "agent_reviews_user_id_system_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_reviews_target" ON "agent_reviews" USING btree ("kind","target_id");
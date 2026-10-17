CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"actor_id" varchar(100) NOT NULL,
	"actor_email" varchar(320) NOT NULL,
	"source" varchar(10) NOT NULL,
	"project_id" varchar(50),
	"project_name" varchar(200),
	"project_slug" varchar(200),
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(100) NOT NULL,
	"action" varchar(50) NOT NULL,
	"changed_fields" jsonb NOT NULL,
	"status" varchar(10) NOT NULL,
	"message" text
);
--> statement-breakpoint
CREATE INDEX "idx_audit_events_project_ts" ON "audit_events" USING btree ("project_id","ts");--> statement-breakpoint
CREATE INDEX "idx_audit_events_actor_ts" ON "audit_events" USING btree ("actor_id","ts");--> statement-breakpoint
CREATE INDEX "idx_audit_events_ts" ON "audit_events" USING btree ("ts");
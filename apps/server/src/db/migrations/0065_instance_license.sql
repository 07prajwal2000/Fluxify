CREATE TABLE "instance_license" (
	"id" varchar(20) PRIMARY KEY DEFAULT 'current' NOT NULL,
	"key" text,
	"confirmed_by" varchar(50),
	"confirmed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_license" ADD CONSTRAINT "instance_license_confirmed_by_system_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."system_users"("id") ON DELETE set null ON UPDATE no action;
CREATE TABLE "system_users" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"is_system_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "access_control" DROP CONSTRAINT "access_control_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_chat_conversations" DROP CONSTRAINT "ai_chat_conversations_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_harness_conversations" DROP CONSTRAINT "agent_harness_conversations_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "access_control" ADD CONSTRAINT "access_control_user_id_system_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chat_conversations" ADD CONSTRAINT "ai_chat_conversations_user_id_system_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_harness_conversations" ADD CONSTRAINT "agent_harness_conversations_user_id_system_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_id_system_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."system_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "is_system_admin";
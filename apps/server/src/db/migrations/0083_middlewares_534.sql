CREATE TYPE "public"."custom_block_usage" AS ENUM('flow', 'test', 'middleware');--> statement-breakpoint
CREATE TYPE "public"."middleware_phase" AS ENUM('before', 'after');--> statement-breakpoint
CREATE TABLE "middleware_blocks" (
	"middleware_id" varchar(50) NOT NULL,
	"custom_block_id" varchar(50) NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "middleware_blocks_middleware_id_custom_block_id_pk" PRIMARY KEY("middleware_id","custom_block_id")
);
--> statement-breakpoint
CREATE TABLE "middlewares" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_middlewares" (
	"route_id" varchar(50) NOT NULL,
	"middleware_id" varchar(50) NOT NULL,
	"phase" "middleware_phase" NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "route_middlewares_route_id_middleware_id_pk" PRIMARY KEY("route_id","middleware_id")
);
--> statement-breakpoint
ALTER TABLE "custom_blocks_list" ADD COLUMN "usage" "custom_block_usage" DEFAULT 'flow' NOT NULL;--> statement-breakpoint
ALTER TABLE "middleware_blocks" ADD CONSTRAINT "middleware_blocks_middleware_id_middlewares_id_fk" FOREIGN KEY ("middleware_id") REFERENCES "public"."middlewares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "middleware_blocks" ADD CONSTRAINT "middleware_blocks_custom_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("custom_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "middlewares" ADD CONSTRAINT "middlewares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_middlewares" ADD CONSTRAINT "route_middlewares_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_middlewares" ADD CONSTRAINT "route_middlewares_middleware_id_middlewares_id_fk" FOREIGN KEY ("middleware_id") REFERENCES "public"."middlewares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_middleware_blocks_custom_block_id" ON "middleware_blocks" USING btree ("custom_block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_middlewares_project_name" ON "middlewares" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "idx_route_middlewares_middleware_id" ON "route_middlewares" USING btree ("middleware_id");--> statement-breakpoint
-- test-only blocks (#483) keep their meaning under the new usage column
UPDATE "custom_blocks_list" SET "usage" = 'test' WHERE "test_only" = true;
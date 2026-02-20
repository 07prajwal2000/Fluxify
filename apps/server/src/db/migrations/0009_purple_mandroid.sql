CREATE TABLE "test_suites" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"route_id" varchar(50) NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb,
	"params" jsonb DEFAULT '{}'::jsonb,
	"query_params" jsonb DEFAULT '{}'::jsonb,
	"route_params" jsonb DEFAULT '{}'::jsonb,
	"body" jsonb,
	"assertions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "id" SET DEFAULT '019c7cf0-2bf0-7741-85d5-1c4447f84785';--> statement-breakpoint
ALTER TABLE "edges" ALTER COLUMN "id" SET DEFAULT '019c7cf0-2bf0-7741-85d5-1c4551782a21';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "id" SET DEFAULT '019c7cf0-2be5-7209-b467-247bf8acb660';--> statement-breakpoint
ALTER TABLE "routes" ALTER COLUMN "id" SET DEFAULT '019c7cf0-2bf0-7741-85d5-1c4358e51d2e';--> statement-breakpoint
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;
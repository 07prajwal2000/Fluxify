CREATE TABLE "route_response_schemas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"route_id" varchar(50) NOT NULL,
	"status_code" integer NOT NULL,
	"schema" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "route_response_schemas" ADD CONSTRAINT "route_response_schemas_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_route_response_schemas_route_status" ON "route_response_schemas" USING btree ("route_id","status_code");
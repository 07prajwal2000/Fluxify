CREATE TABLE "http_route_config" (
	"route_id" varchar(50) PRIMARY KEY NOT NULL,
	"project_id" varchar(50),
	"route_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "http_route_config" ADD CONSTRAINT "http_route_config_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "http_route_config" ADD CONSTRAINT "http_route_config_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_http_route_config_project_id" ON "http_route_config" USING btree ("project_id");
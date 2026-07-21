ALTER TABLE "routes" ALTER COLUMN "name" SET DATA TYPE varchar(255);--> statement-breakpoint
CREATE INDEX "idx_app_config_key_name_fts" ON "app_config" USING gin (to_tsvector('english', "key_name"));--> statement-breakpoint
CREATE INDEX "idx_app_config_desc_fts" ON "app_config" USING gin (to_tsvector('english', coalesce("description", '')));--> statement-breakpoint
CREATE INDEX "idx_integrations_name_fts" ON "integrations" USING gin (to_tsvector('english', "name"));--> statement-breakpoint
CREATE INDEX "idx_routes_name_fts" ON "routes" USING gin (to_tsvector('english', "name"));
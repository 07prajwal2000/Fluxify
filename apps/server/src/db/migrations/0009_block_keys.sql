ALTER TABLE "blocks" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "custom_blocks_list" ADD COLUMN "block_key_counters" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "block_key_counters" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "block_key_counters" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Give every existing block its key: the n-th block of a type on its canvas is <type>_<n>, oldest first
-- (created_at, then the time-ordered id). A custom block instance is custom_<name>_<n> (its name without the project namespace), as the server names it.
UPDATE "blocks" SET "key" = numbered."prefix" || '_' || numbered."n" FROM (
	SELECT "id", "prefix", row_number() OVER (
		PARTITION BY COALESCE("route_id", "custom_block_id", "workflow_id"), "prefix" ORDER BY "created_at", "id"
	) AS "n"
	FROM (
		SELECT "id", "route_id", "custom_block_id", "workflow_id", "created_at",
			CASE WHEN "type" IN ('entrypoint', 'if', 'httprequest', 'httpgetheader', 'httpsetheader', 'httpgetparam', 'httpgetcookie', 'httpsetcookie', 'httpgetrequestbody', 'forloop', 'foreachloop', 'transformer', 'setvar', 'getvar', 'consolelog', 'jsrunner', 'response', 'arrayops', 'db_getsingle', 'db_exists', 'db_count', 'db_getall', 'db_delete', 'db_insert', 'db_insertbulk', 'db_update', 'db_native', 'db_transaction', 'db_rollback', 'kv_raw', 'kv_operations', 'orchestrator', 'switch', 'sticky_note', 'error_handler', 'cloud_logs', 'trigger_workflow', 'queue_send', 'retry') THEN "type" ELSE 'custom_' || regexp_replace(regexp_replace(COALESCE("type", ''), '^user_defined\.project\.', ''), '[^a-zA-Z0-9_]', '_', 'g') END AS "prefix"
		FROM "blocks"
	) AS typed
) AS numbered WHERE "blocks"."id" = numbered."id";--> statement-breakpoint
-- Each canvas has used exactly as many numbers per prefix as it has blocks, so no key is ever reissued.
UPDATE "routes" SET "block_key_counters" = counted."counters" FROM (
	SELECT "route_id" AS "parent_id", jsonb_object_agg("prefix", "n") AS "counters" FROM (
		SELECT "route_id", regexp_replace("key", '_\d+$', '') AS "prefix", count(*) AS "n"
		FROM "blocks" WHERE "route_id" IS NOT NULL GROUP BY 1, 2
	) AS per_prefix GROUP BY "route_id"
) AS counted WHERE "routes"."id" = counted."parent_id";--> statement-breakpoint
UPDATE "workflows" SET "block_key_counters" = counted."counters" FROM (
	SELECT "workflow_id" AS "parent_id", jsonb_object_agg("prefix", "n") AS "counters" FROM (
		SELECT "workflow_id", regexp_replace("key", '_\d+$', '') AS "prefix", count(*) AS "n"
		FROM "blocks" WHERE "workflow_id" IS NOT NULL GROUP BY 1, 2
	) AS per_prefix GROUP BY "workflow_id"
) AS counted WHERE "workflows"."id" = counted."parent_id";--> statement-breakpoint
UPDATE "custom_blocks_list" SET "block_key_counters" = counted."counters" FROM (
	SELECT "custom_block_id" AS "parent_id", jsonb_object_agg("prefix", "n") AS "counters" FROM (
		SELECT "custom_block_id", regexp_replace("key", '_\d+$', '') AS "prefix", count(*) AS "n"
		FROM "blocks" WHERE "custom_block_id" IS NOT NULL GROUP BY 1, 2
	) AS per_prefix GROUP BY "custom_block_id"
) AS counted WHERE "custom_blocks_list"."id" = counted."parent_id";--> statement-breakpoint
ALTER TABLE "blocks" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_blocks_route_key" ON "blocks" USING btree ("route_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_blocks_custom_block_key" ON "blocks" USING btree ("custom_block_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_blocks_workflow_key" ON "blocks" USING btree ("workflow_id","key");

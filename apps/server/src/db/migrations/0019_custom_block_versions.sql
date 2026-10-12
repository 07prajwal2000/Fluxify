ALTER TABLE "canvas_versions" DROP CONSTRAINT "canvas_versions_one_target";--> statement-breakpoint
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_one_target";--> statement-breakpoint
ALTER TABLE "canvas_versions" ADD COLUMN "custom_block_id" varchar(50);--> statement-breakpoint
ALTER TABLE "canvas_versions" ADD COLUMN "middleware_id" varchar(50);--> statement-breakpoint
ALTER TABLE "custom_blocks_list" ADD COLUMN "committed_revision" integer;--> statement-breakpoint
ALTER TABLE "custom_blocks_list" ADD COLUMN "head_version_id" uuid;--> statement-breakpoint
ALTER TABLE "custom_blocks_list" ADD COLUMN "prod_version_id" uuid;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "custom_block_id" varchar(50);--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "middleware_id" varchar(50);--> statement-breakpoint
ALTER TABLE "middlewares" ADD COLUMN "canvas_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "middlewares" ADD COLUMN "committed_revision" integer;--> statement-breakpoint
ALTER TABLE "middlewares" ADD COLUMN "head_version_id" uuid;--> statement-breakpoint
ALTER TABLE "middlewares" ADD COLUMN "prod_version_id" uuid;--> statement-breakpoint
ALTER TABLE "canvas_versions" ADD CONSTRAINT "canvas_versions_custom_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("custom_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_versions" ADD CONSTRAINT "canvas_versions_middleware_id_middlewares_id_fk" FOREIGN KEY ("middleware_id") REFERENCES "public"."middlewares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_blocks_list" ADD CONSTRAINT "custom_blocks_list_head_version_id_canvas_versions_id_fk" FOREIGN KEY ("head_version_id") REFERENCES "public"."canvas_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_blocks_list" ADD CONSTRAINT "custom_blocks_list_prod_version_id_canvas_versions_id_fk" FOREIGN KEY ("prod_version_id") REFERENCES "public"."canvas_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_custom_block_id_custom_blocks_list_id_fk" FOREIGN KEY ("custom_block_id") REFERENCES "public"."custom_blocks_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_middleware_id_middlewares_id_fk" FOREIGN KEY ("middleware_id") REFERENCES "public"."middlewares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "middlewares" ADD CONSTRAINT "middlewares_head_version_id_canvas_versions_id_fk" FOREIGN KEY ("head_version_id") REFERENCES "public"."canvas_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "middlewares" ADD CONSTRAINT "middlewares_prod_version_id_canvas_versions_id_fk" FOREIGN KEY ("prod_version_id") REFERENCES "public"."canvas_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_canvas_versions_custom_block_number" ON "canvas_versions" USING btree ("custom_block_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_canvas_versions_middleware_number" ON "canvas_versions" USING btree ("middleware_id","version_number");--> statement-breakpoint
CREATE INDEX "idx_deployments_custom_block" ON "deployments" USING btree ("custom_block_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_deployments_middleware" ON "deployments" USING btree ("middleware_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "canvas_versions" ADD CONSTRAINT "canvas_versions_one_target" CHECK (("canvas_versions"."kind" = 'route' and "canvas_versions"."route_id" is not null and "canvas_versions"."workflow_id" is null and "canvas_versions"."custom_block_id" is null and "canvas_versions"."middleware_id" is null)
	or ("canvas_versions"."kind" = 'workflow' and "canvas_versions"."workflow_id" is not null and "canvas_versions"."route_id" is null and "canvas_versions"."custom_block_id" is null and "canvas_versions"."middleware_id" is null)
	or ("canvas_versions"."kind" = 'custom_block' and "canvas_versions"."custom_block_id" is not null and "canvas_versions"."route_id" is null and "canvas_versions"."workflow_id" is null and "canvas_versions"."middleware_id" is null)
	or ("canvas_versions"."kind" = 'middleware' and "canvas_versions"."middleware_id" is not null and "canvas_versions"."route_id" is null and "canvas_versions"."workflow_id" is null and "canvas_versions"."custom_block_id" is null));--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_one_target" CHECK (("deployments"."kind" = 'route' and "deployments"."route_id" is not null and "deployments"."workflow_id" is null and "deployments"."custom_block_id" is null and "deployments"."middleware_id" is null)
	or ("deployments"."kind" = 'workflow' and "deployments"."workflow_id" is not null and "deployments"."route_id" is null and "deployments"."custom_block_id" is null and "deployments"."middleware_id" is null)
	or ("deployments"."kind" = 'custom_block' and "deployments"."custom_block_id" is not null and "deployments"."route_id" is null and "deployments"."workflow_id" is null and "deployments"."middleware_id" is null)
	or ("deployments"."kind" = 'middleware' and "deployments"."middleware_id" is not null and "deployments"."route_id" is null and "deployments"."workflow_id" is null and "deployments"."custom_block_id" is null));--> statement-breakpoint
-- Upgrade seed (#740). Production used to run every custom block and middleware
-- as it was saved, and it must keep running exactly that. Each one gets a first
-- version built from its current state, promoted as its first deployment, and
-- made its head, the same way 0017 did it for routes and workflows. Rows with no
-- project are skipped: a version needs one. The version ids are UUIDv7 (the API
-- validates them as such), built here because Postgres 16 has no uuidv7().
CREATE TEMP TABLE "_block_seed" (
	"kind" varchar(16) NOT NULL,
	"target_id" varchar(50) NOT NULL,
	"version_id" uuid NOT NULL
);--> statement-breakpoint
INSERT INTO "_block_seed" ("kind", "target_id", "version_id")
SELECT 'custom_block', c."id",
	(lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0')
		|| '7' || substr(md5(random()::text || c."id"), 1, 3)
		|| substr('89ab', 1 + floor(random() * 4)::int, 1)
		|| substr(md5(random()::text || clock_timestamp()::text), 1, 15))::uuid
FROM "custom_blocks_list" c WHERE c."project_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "_block_seed" ("kind", "target_id", "version_id")
SELECT 'middleware', m."id",
	(lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0')
		|| '7' || substr(md5(random()::text || m."id"), 1, 3)
		|| substr('89ab', 1 + floor(random() * 4)::int, 1)
		|| substr(md5(random()::text || clock_timestamp()::text), 1, 15))::uuid
FROM "middlewares" m;--> statement-breakpoint
INSERT INTO "canvas_versions" ("id", "kind", "custom_block_id", "project_id", "version_number", "title", "description", "snapshot")
SELECT s."version_id", 'custom_block', c."id", c."project_id", 1, 'Initial',
	'Saved when custom block versions were introduced: this is what production was running.',
	jsonb_build_object(
		'blocks', coalesce((
			SELECT jsonb_agg(jsonb_build_object(
				'id', b."id", 'key', b."key", 'type', b."type", 'data', b."data",
				'position', coalesce(b."position", '{"x":0,"y":0}'::jsonb)) ORDER BY b."id")
			FROM "blocks" b WHERE b."custom_block_id" = c."id"), '[]'::jsonb),
		'edges', coalesce((
			SELECT jsonb_agg(jsonb_build_object(
				'id', e."id", 'from', e."from", 'to', e."to",
				'fromHandle', e."from_handle", 'toHandle', e."to_handle") ORDER BY e."id")
			FROM "edges" e WHERE e."custom_block_id" = c."id"), '[]'::jsonb),
		'settings', jsonb_build_object(
			'inputParams', c."input_params",
			'usage', c."usage"::text))
FROM "_block_seed" s JOIN "custom_blocks_list" c ON c."id" = s."target_id" WHERE s."kind" = 'custom_block';--> statement-breakpoint
INSERT INTO "canvas_versions" ("id", "kind", "middleware_id", "project_id", "version_number", "title", "description", "snapshot")
SELECT s."version_id", 'middleware', m."id", m."project_id", 1, 'Initial',
	'Saved when middleware versions were introduced: this is what production was running.',
	jsonb_build_object(
		'blocks', '[]'::jsonb,
		'edges', '[]'::jsonb,
		'settings', jsonb_build_object(
			'chain', coalesce((
				SELECT jsonb_agg(l."custom_block_id" ORDER BY l."position")
				FROM "middleware_blocks" l WHERE l."middleware_id" = m."id"), '[]'::jsonb)))
FROM "_block_seed" s JOIN "middlewares" m ON m."id" = s."target_id" WHERE s."kind" = 'middleware';--> statement-breakpoint
INSERT INTO "deployments" ("id", "kind", "custom_block_id", "project_id", "version_id", "action", "description", "status", "gates", "finished_at")
SELECT
	(lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0')
		|| '7' || substr(md5(random()::text || c."id"), 1, 3)
		|| substr('89ab', 1 + floor(random() * 4)::int, 1)
		|| substr(md5(random()::text || clock_timestamp()::text), 1, 15))::uuid,
	'custom_block', c."id", c."project_id", s."version_id", 'promote',
	'Promoted automatically when custom block versions were introduced', 'live', '[]'::jsonb, now()
FROM "_block_seed" s JOIN "custom_blocks_list" c ON c."id" = s."target_id" WHERE s."kind" = 'custom_block';--> statement-breakpoint
INSERT INTO "deployments" ("id", "kind", "middleware_id", "project_id", "version_id", "action", "description", "status", "gates", "finished_at")
SELECT
	(lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0')
		|| '7' || substr(md5(random()::text || m."id"), 1, 3)
		|| substr('89ab', 1 + floor(random() * 4)::int, 1)
		|| substr(md5(random()::text || clock_timestamp()::text), 1, 15))::uuid,
	'middleware', m."id", m."project_id", s."version_id", 'promote',
	'Promoted automatically when middleware versions were introduced', 'live', '[]'::jsonb, now()
FROM "_block_seed" s JOIN "middlewares" m ON m."id" = s."target_id" WHERE s."kind" = 'middleware';--> statement-breakpoint
UPDATE "custom_blocks_list" c SET "prod_version_id" = s."version_id", "head_version_id" = s."version_id", "committed_revision" = c."canvas_revision"
FROM "_block_seed" s WHERE s."kind" = 'custom_block' AND s."target_id" = c."id";--> statement-breakpoint
UPDATE "middlewares" m SET "prod_version_id" = s."version_id", "head_version_id" = s."version_id", "committed_revision" = m."canvas_revision"
FROM "_block_seed" s WHERE s."kind" = 'middleware' AND s."target_id" = m."id";--> statement-breakpoint
DROP TABLE "_block_seed";

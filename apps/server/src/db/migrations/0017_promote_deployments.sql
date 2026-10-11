CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(16) NOT NULL,
	"route_id" varchar(50),
	"workflow_id" varchar(50),
	"project_id" varchar(50) NOT NULL,
	"version_id" uuid NOT NULL,
	"action" varchar(16) NOT NULL,
	"description" text NOT NULL,
	"author_id" varchar(50),
	"author_email" text,
	"status" varchar(16) NOT NULL,
	"gates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "deployments_one_target" CHECK (("deployments"."kind" = 'route' and "deployments"."route_id" is not null and "deployments"."workflow_id" is null)
				or ("deployments"."kind" = 'workflow' and "deployments"."workflow_id" is not null and "deployments"."route_id" is null))
);
--> statement-breakpoint
ALTER TABLE "routes" ADD COLUMN "prod_version_id" uuid;--> statement-breakpoint
ALTER TABLE "trace_runs" ADD COLUMN "version_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "prod_version_id" uuid;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_version_id_canvas_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."canvas_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_author_id_system_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."system_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_deployments_route" ON "deployments" USING btree ("route_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_deployments_workflow" ON "deployments" USING btree ("workflow_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_deployments_project_id" ON "deployments" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_prod_version_id_canvas_versions_id_fk" FOREIGN KEY ("prod_version_id") REFERENCES "public"."canvas_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_prod_version_id_canvas_versions_id_fk" FOREIGN KEY ("prod_version_id") REFERENCES "public"."canvas_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Upgrade seed (#739). Production used to serve the working copy, and it must keep
-- serving exactly that. Every route and workflow gets one new version built from
-- its working copy, promoted as the first deployment, and made its head. Rows with
-- no project are skipped: a version needs one. The version ids are UUIDv7 (the API
-- validates them as such), built here because Postgres 16 has no uuidv7().
CREATE TEMP TABLE "_promote_seed" (
	"kind" varchar(16) NOT NULL,
	"target_id" varchar(50) NOT NULL,
	"version_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"parent_id" uuid
);--> statement-breakpoint
INSERT INTO "_promote_seed" ("kind", "target_id", "version_id", "version_number", "parent_id")
SELECT 'route', r."id",
	(lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0')
		|| '7' || substr(md5(random()::text || r."id"), 1, 3)
		|| substr('89ab', 1 + floor(random() * 4)::int, 1)
		|| substr(md5(random()::text || clock_timestamp()::text), 1, 15))::uuid,
	coalesce((SELECT max(v."version_number") FROM "canvas_versions" v WHERE v."route_id" = r."id"), 0) + 1,
	r."head_version_id"
FROM "routes" r WHERE r."project_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "_promote_seed" ("kind", "target_id", "version_id", "version_number", "parent_id")
SELECT 'workflow', w."id",
	(lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0')
		|| '7' || substr(md5(random()::text || w."id"), 1, 3)
		|| substr('89ab', 1 + floor(random() * 4)::int, 1)
		|| substr(md5(random()::text || clock_timestamp()::text), 1, 15))::uuid,
	coalesce((SELECT max(v."version_number") FROM "canvas_versions" v WHERE v."workflow_id" = w."id"), 0) + 1,
	w."head_version_id"
FROM "workflows" w WHERE w."project_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "canvas_versions" ("id", "kind", "route_id", "project_id", "version_number", "parent_id", "title", "description", "snapshot")
SELECT s."version_id", 'route', r."id", r."project_id", s."version_number", s."parent_id",
	CASE WHEN s."version_number" = 1 THEN 'Initial' ELSE 'Live in production at upgrade' END,
	'Saved when production deployments were introduced: this is what production was serving.',
	jsonb_build_object(
		'blocks', coalesce((
			SELECT jsonb_agg(jsonb_build_object(
				'id', b."id", 'key', b."key", 'type', b."type", 'data', b."data",
				'position', coalesce(b."position", '{"x":0,"y":0}'::jsonb)) ORDER BY b."id")
			FROM "blocks" b WHERE b."route_id" = r."id"), '[]'::jsonb),
		'edges', coalesce((
			SELECT jsonb_agg(jsonb_build_object(
				'id', e."id", 'from', e."from", 'to', e."to",
				'fromHandle', e."from_handle", 'toHandle', e."to_handle") ORDER BY e."id")
			FROM "edges" e WHERE e."route_id" = r."id"), '[]'::jsonb),
		'settings', jsonb_build_object(
			'path', r."path", 'method', r."method",
			'bodySchema', r."body_schema", 'querySchema', r."query_schema", 'paramsSchema', r."params_schema",
			'timeoutSeconds', r."timeout_seconds",
			'middlewares', jsonb_build_object(
				'before', coalesce((SELECT jsonb_agg(m."middleware_id" ORDER BY m."position")
					FROM "route_middlewares" m WHERE m."route_id" = r."id" AND m."phase" = 'before'), '[]'::jsonb),
				'after', coalesce((SELECT jsonb_agg(m."middleware_id" ORDER BY m."position")
					FROM "route_middlewares" m WHERE m."route_id" = r."id" AND m."phase" = 'after'), '[]'::jsonb))))
FROM "_promote_seed" s JOIN "routes" r ON r."id" = s."target_id" WHERE s."kind" = 'route';--> statement-breakpoint
INSERT INTO "canvas_versions" ("id", "kind", "workflow_id", "project_id", "version_number", "parent_id", "title", "description", "snapshot")
SELECT s."version_id", 'workflow', w."id", w."project_id", s."version_number", s."parent_id",
	CASE WHEN s."version_number" = 1 THEN 'Initial' ELSE 'Live in production at upgrade' END,
	'Saved when production deployments were introduced: this is what production was serving.',
	jsonb_build_object(
		'blocks', coalesce((
			SELECT jsonb_agg(jsonb_build_object(
				'id', b."id", 'key', b."key", 'type', b."type", 'data', b."data",
				'position', coalesce(b."position", '{"x":0,"y":0}'::jsonb)) ORDER BY b."id")
			FROM "blocks" b WHERE b."workflow_id" = w."id"), '[]'::jsonb),
		'edges', coalesce((
			SELECT jsonb_agg(jsonb_build_object(
				'id', e."id", 'from', e."from", 'to', e."to",
				'fromHandle', e."from_handle", 'toHandle', e."to_handle") ORDER BY e."id")
			FROM "edges" e WHERE e."workflow_id" = w."id"), '[]'::jsonb),
		'settings', jsonb_build_object('timeoutSeconds', w."timeout_seconds"))
FROM "_promote_seed" s JOIN "workflows" w ON w."id" = s."target_id" WHERE s."kind" = 'workflow';--> statement-breakpoint
INSERT INTO "deployments" ("id", "kind", "route_id", "project_id", "version_id", "action", "description", "status", "gates", "finished_at")
SELECT
	(lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0')
		|| '7' || substr(md5(random()::text || r."id"), 1, 3)
		|| substr('89ab', 1 + floor(random() * 4)::int, 1)
		|| substr(md5(random()::text || clock_timestamp()::text), 1, 15))::uuid,
	'route', r."id", r."project_id", s."version_id", 'promote',
	'Promoted automatically when production deployments were introduced', 'live', '[]'::jsonb, now()
FROM "_promote_seed" s JOIN "routes" r ON r."id" = s."target_id" WHERE s."kind" = 'route';--> statement-breakpoint
INSERT INTO "deployments" ("id", "kind", "workflow_id", "project_id", "version_id", "action", "description", "status", "gates", "finished_at")
SELECT
	(lpad(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0')
		|| '7' || substr(md5(random()::text || w."id"), 1, 3)
		|| substr('89ab', 1 + floor(random() * 4)::int, 1)
		|| substr(md5(random()::text || clock_timestamp()::text), 1, 15))::uuid,
	'workflow', w."id", w."project_id", s."version_id", 'promote',
	'Promoted automatically when production deployments were introduced', 'live', '[]'::jsonb, now()
FROM "_promote_seed" s JOIN "workflows" w ON w."id" = s."target_id" WHERE s."kind" = 'workflow';--> statement-breakpoint
UPDATE "routes" r SET "prod_version_id" = s."version_id", "head_version_id" = s."version_id", "committed_revision" = r."canvas_revision"
FROM "_promote_seed" s WHERE s."kind" = 'route' AND s."target_id" = r."id";--> statement-breakpoint
UPDATE "workflows" w SET "prod_version_id" = s."version_id", "head_version_id" = s."version_id", "committed_revision" = w."canvas_revision"
FROM "_promote_seed" s WHERE s."kind" = 'workflow' AND s."target_id" = w."id";--> statement-breakpoint
DROP TABLE "_promote_seed";

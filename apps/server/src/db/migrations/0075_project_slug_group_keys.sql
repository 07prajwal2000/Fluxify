-- #456: projects get a fixed slug and group names become slugs, so a NodeClaim
-- names them as `<project slug>/<group name>`. Existing rows are slugged from
-- their name; a clash gets the tail of the row id, which is random.
ALTER TABLE "projects" ADD COLUMN "slug" varchar(50);--> statement-breakpoint
WITH base AS (
	SELECT "id", COALESCE(NULLIF(rtrim(left(trim(BOTH '-' FROM regexp_replace(lower(COALESCE("name", '')), '[^a-z0-9]+', '-', 'g')), 41), '-'), ''), 'project') AS "slug"
	FROM "projects"
), ranked AS (
	SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "id") AS "n" FROM base
)
UPDATE "projects" p SET "slug" = CASE WHEN r."n" = 1 THEN r."slug" ELSE r."slug" || '-' || right(p."id", 8) END
FROM ranked r WHERE r."id" = p."id";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_projects_slug" ON "projects" USING btree ("slug");--> statement-breakpoint
WITH base AS (
	SELECT "id", "project_id" AS "pid", COALESCE(NULLIF(rtrim(left(trim(BOTH '-' FROM regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), 41), '-'), ''), 'group') AS "slug"
	FROM "trigger_groups"
), ranked AS (
	-- A name that is already the slug keeps it, so no update clashes on the unique index.
	SELECT "id", base."slug", row_number() OVER (PARTITION BY "pid", base."slug" ORDER BY "name" = base."slug" DESC, "id") AS "n"
	FROM base JOIN "trigger_groups" USING ("id")
)
UPDATE "trigger_groups" g SET "name" = CASE WHEN r."n" = 1 THEN r."slug" ELSE r."slug" || '-' || right(g."id", 8) END
FROM ranked r WHERE r."id" = g."id" AND g."name" IS DISTINCT FROM (CASE WHEN r."n" = 1 THEN r."slug" ELSE r."slug" || '-' || right(g."id", 8) END);

--
-- `parent_type`/`parent_id` were a derived read surface over the three canvas
-- foreign keys. A generated column cannot be altered in place, so a schema push
-- silently left them on their old expression and every workflow canvas read back
-- empty. Reads go straight to the foreign key now — one column, one index, no
-- second copy of the truth to fall behind.
--
DROP INDEX IF EXISTS "idx_blocks_parent";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_edges_parent";--> statement-breakpoint
ALTER TABLE "blocks" DROP COLUMN IF EXISTS "parent_type";--> statement-breakpoint
ALTER TABLE "blocks" DROP COLUMN IF EXISTS "parent_id";--> statement-breakpoint
ALTER TABLE "edges" DROP COLUMN IF EXISTS "parent_type";--> statement-breakpoint
ALTER TABLE "edges" DROP COLUMN IF EXISTS "parent_id";

-- Move custom block canvases into the unified blocks/edges tables.
-- Positions lived in `data.position` and edges in `data.connections`; both
-- become real columns/rows here.
INSERT INTO "blocks" ("id", "type", "position", "data", "custom_block_id")
SELECT
    g."id",
    g."type",
    COALESCE(g."data" -> 'position', '{"x":0,"y":0}'::jsonb),
    (COALESCE(g."data", '{}'::jsonb) - 'position' - 'connections'),
    g."custom_block_id"
FROM "custom_block_graphs" g
WHERE g."custom_block_id" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "edges" ("id", "from", "to", "from_handle", "to_handle", "custom_block_id")
SELECT
    c ->> 'id',
    g."id",
    c ->> 'to',
    c ->> 'fromHandle',
    c ->> 'toHandle',
    g."custom_block_id"
FROM "custom_block_graphs" g,
     LATERAL jsonb_array_elements(COALESCE(g."data" -> 'connections', '[]'::jsonb)) c
WHERE g."custom_block_id" IS NOT NULL
  AND c ->> 'id' IS NOT NULL
  -- a connection pointing at a block that no longer exists would trip the FK
  AND EXISTS (SELECT 1 FROM "blocks" b WHERE b."id" = c ->> 'to')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
DROP TABLE "custom_block_graphs" CASCADE;

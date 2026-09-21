ALTER TABLE "node_claims" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Node sizes move from the pool to each claim (#429). Copy what an operator set,
-- rounded up onto the new steps (0.5 CPU, 256 MB), so no running node shrinks.
UPDATE "node_claims" SET "metadata" = jsonb_build_object('resources', jsonb_strip_nulls(jsonb_build_object(
	'cpu', CASE WHEN s.value ? 'cpuPerNode'
		THEN LEAST(16, GREATEST(0.5, CEIL((s.value->>'cpuPerNode')::numeric * 2) / 2))::float8 END,
	'memoryMb', CASE WHEN s.value ? 'memoryPerNodeMb'
		THEN LEAST(65536, GREATEST(256, CEIL((s.value->>'memoryPerNodeMb')::numeric / 256) * 256))::int END
)))
FROM "instance_settings" s
WHERE s.key = 'orchestration_pool' AND (s.value ? 'cpuPerNode' OR s.value ? 'memoryPerNodeMb');--> statement-breakpoint
UPDATE "instance_settings" SET "value" = "value" - 'cpuPerNode' - 'memoryPerNodeMb' WHERE "key" = 'orchestration_pool';

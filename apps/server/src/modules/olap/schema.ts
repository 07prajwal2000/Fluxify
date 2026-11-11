/**
 * ClickHouse tables (#760). Idempotent: run on every admin boot. The TTLs are
 * re-applied each time, so a changed `RECORDING_MAX_AGE_DAYS` /
 * `AUDIT_LOG_MAX_AGE_DAYS` lands on restart. TTL replaces the daily retention
 * jobs. JSON is kept as text and read with `JSONExtract*`.
 *
 * ReplacingMergeTree + `FINAL` on reads: a redelivered run or event collapses
 * to one row, as `ON CONFLICT DO NOTHING` does in Postgres.
 */
export function olapSchema(recordingDays: number, auditDays: number) {
	const rec = `INTERVAL ${Math.trunc(recordingDays)} DAY`;
	const audit = `INTERVAL ${Math.trunc(auditDays)} DAY`;
	return [
		`CREATE TABLE IF NOT EXISTS trace_runs (
			id UUID,
			project_id String,
			route_id Nullable(String),
			workflow_id Nullable(String),
			sandbox_id Nullable(String),
			route_version Nullable(String),
			workflow_version Nullable(String),
			version_id Nullable(UUID),
			started_at DateTime64(3, 'UTC'),
			ended_at Nullable(DateTime64(3, 'UTC')),
			outcome LowCardinality(String),
			status_code Nullable(Int32),
			truncated Bool,
			dropped_spans Int32,
			parent_run_id Nullable(UUID),
			parent_seq Nullable(Int32),
			span_count Int32,
			metadata Nullable(String),
			env LowCardinality(String)
		) ENGINE = ReplacingMergeTree
		PARTITION BY toYYYYMM(started_at)
		ORDER BY (project_id, started_at, id)
		TTL toDateTime(started_at) + ${rec}`,
		`CREATE TABLE IF NOT EXISTS trace_spans (
			run_id UUID,
			seq Int32,
			parent_seq Nullable(Int32),
			block_id String,
			block_type String,
			block_name Nullable(String),
			custom_block_id Nullable(String),
			middleware Nullable(String),
			started_at DateTime64(3, 'UTC'),
			ended_at DateTime64(3, 'UTC'),
			outcome LowCardinality(String),
			branch Nullable(String),
			error Nullable(String),
			input Nullable(String),
			output Nullable(String),
			truncated Bool,
			metadata Nullable(String)
		) ENGINE = ReplacingMergeTree
		PARTITION BY toYYYYMM(started_at)
		ORDER BY (run_id, seq)
		TTL toDateTime(started_at) + ${rec}`,
		`CREATE TABLE IF NOT EXISTS system_logs (
			id UInt64,
			project_id String,
			resource_type String,
			resource_id String,
			type LowCardinality(String),
			level LowCardinality(String),
			message String,
			detail Nullable(String),
			run_id Nullable(UUID),
			updated_at DateTime64(3, 'UTC')
		) ENGINE = MergeTree
		PARTITION BY toYYYYMM(updated_at)
		ORDER BY (project_id, updated_at)
		TTL toDateTime(updated_at) + ${rec}`,
		`CREATE TABLE IF NOT EXISTS audit_events (
			id UUID,
			ts DateTime64(3, 'UTC'),
			actor_id String,
			actor_email String,
			source LowCardinality(String),
			project_id Nullable(String),
			project_name Nullable(String),
			project_slug Nullable(String),
			resource_type LowCardinality(String),
			resource_id String,
			action LowCardinality(String),
			changed_fields Array(String),
			status LowCardinality(String),
			message Nullable(String)
		) ENGINE = ReplacingMergeTree
		PARTITION BY toYYYYMM(ts)
		ORDER BY (ts, id)
		TTL toDateTime(ts) + ${audit}`,
		`ALTER TABLE trace_runs MODIFY TTL toDateTime(started_at) + ${rec}`,
		`ALTER TABLE trace_spans MODIFY TTL toDateTime(started_at) + ${rec}`,
		`ALTER TABLE system_logs MODIFY TTL toDateTime(updated_at) + ${rec}`,
		`ALTER TABLE audit_events MODIFY TTL toDateTime(ts) + ${audit}`,
	];
}

import { describe, it, expect } from "bun:test";
import { createOtlpTracerProvider, exportRun, traceIdFor } from "../traces";
import { createOtlpMeterProvider, recordRun } from "../metrics";
import { flushTelemetry, shutdownTelemetry } from "../flush";
import type { TraceRunPayload } from "../types";

/**
 * Exercises the real wire against the local stack in `docker-compose.yml`.
 *
 * Skipped unless `OTLP_LIVE_TEST=1`, so CI stays offline. Run it with:
 *   docker compose up -d jaeger prometheus
 *   OTLP_LIVE_TEST=1 bun test packages/common/otlp
 */
const live = process.env.OTLP_LIVE_TEST === "1";
const JAEGER = process.env.JAEGER_URL ?? "http://localhost:4318";
const JAEGER_API = process.env.JAEGER_API_URL ?? "http://localhost:16686";
const PROMETHEUS = process.env.PROMETHEUS_URL ?? "http://localhost:9090";

const PERF_ORIGIN = 5_000;

function payload(runId: string): TraceRunPayload {
	const now = Date.now();
	return {
		runId,
		projectId: "proj-live",
		routeId: "route-live",
		routeVersion: new Date(now).toISOString(),
		method: "POST",
		path: "/live-check",
		startedAtWallMs: now,
		perfOrigin: PERF_ORIGIN,
		endedAt: PERF_ORIGIN + 120,
		outcome: "failure",
		statusCode: 500,
		spans: [
			{
				seq: 0,
				blockId: "entry",
				blockType: "entrypoint",
				startedAt: PERF_ORIGIN + 1,
				endedAt: PERF_ORIGIN + 3,
				outcome: "success",
				input: { id: 42 },
				output: { id: 42 },
			},
			{
				seq: 1,
				blockId: "inner",
				blockType: "jsrunner",
				parentSeq: 2,
				customBlockId: "cb-live",
				startedAt: PERF_ORIGIN + 12,
				endedAt: PERF_ORIGIN + 18,
				outcome: "success",
			},
			// recorded after its child, as a real invoking block would be
			{
				seq: 2,
				blockId: "invoke",
				blockType: "custom_block",
				startedAt: PERF_ORIGIN + 10,
				endedAt: PERF_ORIGIN + 20,
				outcome: "success",
			},
			{
				seq: 3,
				blockId: "explode",
				blockType: "jsrunner",
				startedAt: PERF_ORIGIN + 30,
				endedAt: PERF_ORIGIN + 34,
				outcome: "failure",
				error: "boom",
			},
		],
	};
}

/** the backends ingest asynchronously; poll rather than guess a sleep */
async function eventually<T>(
	probe: () => Promise<T | null>,
	timeoutMs = 20_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let last: unknown;
	while (Date.now() < deadline) {
		try {
			const result = await probe();
			if (result) return result;
		} catch (error) {
			last = error;
		}
		await Bun.sleep(500);
	}
	throw new Error(`condition not met within ${timeoutMs}ms: ${String(last)}`);
}

describe.skipIf(!live)("live OTLP export", () => {
	it("lands a run in Jaeger as one nested trace", async () => {
		const runId = `live-${crypto.randomUUID()}`;
		const provider = createOtlpTracerProvider({
			url: JAEGER,
			serviceName: "fluxify-live-test",
		});

		exportRun(provider, payload(runId));
		await flushTelemetry(provider);

		const traceId = traceIdFor(runId);
		const trace = await eventually(async () => {
			const response = await fetch(`${JAEGER_API}/api/traces/${traceId}`);
			if (!response.ok) return null;
			const body = (await response.json()) as { data?: { spans: any[] }[] };
			const found = body.data?.[0];
			return found && found.spans.length === 5 ? found : null;
		});

		const spans: any[] = trace.spans;
		const root = spans.find((s) => s.operationName === "POST /live-check")!;
		const invoke = spans.find((s) =>
			s.tags.some((t: any) => t.key === "fluxify.block.id" && t.value === "invoke"),
		)!;
		const inner = spans.find((s) =>
			s.tags.some((t: any) => t.key === "fluxify.block.id" && t.value === "inner"),
		)!;
		const explode = spans.find((s) =>
			s.tags.some((t: any) => t.key === "fluxify.block.id" && t.value === "explode"),
		)!;

		// nesting survived the wire, including the child recorded before its parent
		expect(inner.references[0]?.spanID).toBe(invoke.spanID);
		expect(invoke.references[0]?.spanID).toBe(root.spanID);
		// wall clock, not monotonic readings: Jaeger reports epoch microseconds
		expect(root.startTime).toBeGreaterThan(Date.UTC(2026, 0, 1) * 1000);
		expect(root.duration).toBe(120_000);
		expect(explode.tags.some((t: any) => t.key === "error" && t.value === true)).toBe(
			true,
		);

		await shutdownTelemetry(provider);
	}, 60_000);

	it("pushes route metrics into Prometheus", async () => {
		const provider = createOtlpMeterProvider({
			url: `${PROMETHEUS}/api/v1/otlp`,
			serviceName: "fluxify-live-test",
			exportIntervalMillis: 1_000,
		});

		recordRun(provider, payload(`live-${crypto.randomUUID()}`));
		await flushTelemetry(provider);

		const value = await eventually(async () => {
			const response = await fetch(
				`${PROMETHEUS}/api/v1/query?query=fluxify_route_requests_total`,
			);
			const body = (await response.json()) as {
				data?: { result?: { value: [number, string] }[] };
			};
			return body.data?.result?.length ? body.data.result[0]!.value[1] : null;
		});

		expect(Number(value)).toBeGreaterThan(0);
		await shutdownTelemetry(provider);
	}, 60_000);
});

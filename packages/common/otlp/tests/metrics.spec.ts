import { describe, it, expect } from "bun:test";
import {
	AggregationTemporality,
	InMemoryMetricExporter,
	PeriodicExportingMetricReader,
	type MetricData,
} from "@opentelemetry/sdk-metrics";
import { createOtlpMeterProvider, recordRun } from "../metrics";
import type { TraceRunPayload } from "../types";

const PERF_ORIGIN = 1_000;

const run = (overrides: Partial<TraceRunPayload> = {}): TraceRunPayload => ({
	runId: "run-1",
	projectId: "proj-1",
	routeId: "route-1",
	routeVersion: "v1",
	method: "POST",
	path: "/orders",
	startedAtWallMs: Date.UTC(2026, 0, 1),
	perfOrigin: PERF_ORIGIN,
	endedAt: PERF_ORIGIN + 40,
	outcome: "success",
	spans: [],
	...overrides,
});

function collector() {
	const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
	const reader = new PeriodicExportingMetricReader({
		exporter,
		// long enough that only the explicit forceFlush below produces a batch
		exportIntervalMillis: 60_000,
	});
	const provider = createOtlpMeterProvider({
		url: "http://unused",
		serviceName: "test",
		reader,
	});
	const collect = async (): Promise<MetricData[]> => {
		await provider.forceFlush();
		return exporter
			.getMetrics()
			.flatMap((resource) => resource.scopeMetrics)
			.flatMap((scope) => scope.metrics);
	};
	return { provider, collect };
}

const find = (metrics: MetricData[], name: string) =>
	metrics.find((metric) => metric.descriptor.name === name)!;

describe("recordRun", () => {
	it("counts a run and records its wall time", async () => {
		const { provider, collect } = collector();

		recordRun(provider, run());

		const metrics = await collect();
		const requests = find(metrics, "fluxify.route.requests");
		expect(requests.dataPoints[0]?.value).toBe(1);
		expect(requests.dataPoints[0]?.attributes).toMatchObject({
			"fluxify.project.id": "proj-1",
			"http.route": "/orders",
			"fluxify.outcome": "success",
		});
		const duration = find(metrics, "fluxify.route.duration");
		expect((duration.dataPoints[0]?.value as { sum: number }).sum).toBe(40);
	});

	it("aggregates repeated runs instead of allocating new instruments", async () => {
		const { provider, collect } = collector();

		recordRun(provider, run());
		recordRun(provider, run({ runId: "run-2" }));

		const requests = find(await collect(), "fluxify.route.requests");
		// one series, counted twice — a fresh instrument per call would give two
		expect(requests.dataPoints).toHaveLength(1);
		expect(requests.dataPoints[0]?.value).toBe(2);
	});

	it("keeps failures on their own series", async () => {
		const { provider, collect } = collector();

		recordRun(provider, run());
		recordRun(provider, run({ outcome: "failure", statusCode: 500 }));

		const requests = find(await collect(), "fluxify.route.requests");
		expect(requests.dataPoints).toHaveLength(2);
		const failed = requests.dataPoints.find(
			(point) => point.attributes["fluxify.outcome"] === "failure",
		);
		expect(failed?.attributes["http.response.status_code"]).toBe(500);
	});
});

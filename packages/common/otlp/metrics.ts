import {
	MeterProvider,
	PeriodicExportingMetricReader,
	type MetricReader,
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { Resource } from "@opentelemetry/resources";
import type { Counter, Histogram } from "@opentelemetry/api";
import type { TraceRunPayload } from "./types";

export interface OtlpMeterOptions {
	/** destination root, e.g. `http://localhost:9090/api/v1/otlp` — `/v1/metrics` is appended */
	url: string;
	headers?: Record<string, string>;
	serviceName: string;
	/** push period; the reader is the push mechanism, there is nothing to scrape */
	exportIntervalMillis?: number;
	/** exposed for tests, which swap in an in-memory reader */
	reader?: MetricReader;
}

/**
 * An unregistered meter provider the caller owns, mirroring
 * `createOtlpTracerProvider`.
 *
 * Push rather than pull: workers sit behind a load balancer, so scraping reaches
 * an arbitrary instance rather than a named one. Prometheus is configured here as
 * an OTLP receiver with an empty scrape config for exactly that reason.
 */
export function createOtlpMeterProvider({
	url,
	headers,
	serviceName,
	exportIntervalMillis = 15_000,
	reader,
}: OtlpMeterOptions): MeterProvider {
	return new MeterProvider({
		resource: Resource.default().merge(
			new Resource({ "service.name": serviceName }),
		),
		readers: [
			reader ??
				new PeriodicExportingMetricReader({
					exporter: new OTLPMetricExporter({
						url: `${url.replace(/\/$/, "")}/v1/metrics`,
						headers: headers ?? {},
					}),
					exportIntervalMillis,
				}),
		],
	});
}

type RouteInstruments = { requests: Counter; duration: Histogram };

/**
 * Instruments are per provider, not per run — creating them per call would
 * allocate a fresh instrument for every request and lose the aggregation.
 */
const instruments = new WeakMap<MeterProvider, RouteInstruments>();

function routeInstruments(provider: MeterProvider): RouteInstruments {
	const existing = instruments.get(provider);
	if (existing) return existing;

	const meter = provider.getMeter("fluxify-route");
	const created: RouteInstruments = {
		requests: meter.createCounter("fluxify.route.requests", {
			description: "Route executions, by outcome",
		}),
		duration: meter.createHistogram("fluxify.route.duration", {
			description: "Route execution wall time",
			unit: "ms",
		}),
	};
	instruments.set(provider, created);
	return created;
}

/**
 * Derive route metrics from a run that was already recorded for tracing.
 *
 * Nothing new crosses the wire for this: the run carries every field the
 * instruments need. Note the consequence — metrics exist only for routes that
 * are traced, so the sample is biased towards whatever the user chose to trace.
 * ponytail: always-on request metrics would mean publishing on every request,
 * which inverts the "untraced route is byte-identical" guarantee; do that as its
 * own change, with its own benchmark.
 */
export function recordRun(provider: MeterProvider, run: TraceRunPayload): void {
	const { requests, duration } = routeInstruments(provider);
	const attributes = {
		"fluxify.project.id": run.projectId,
		"fluxify.route.id": run.routeId,
		"http.request.method": run.method,
		"http.route": run.path,
		"fluxify.outcome": run.outcome,
		...(run.statusCode ? { "http.response.status_code": run.statusCode } : {}),
	};
	requests.add(1, attributes);
	duration.record(run.endedAt - run.perfOrigin, attributes);
}

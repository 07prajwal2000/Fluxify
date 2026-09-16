import { logger } from "@fluxify/common";
import { createObservabilityLogger } from "@fluxify/adapters";
import {
	createOtlpTracerProvider,
	createOtlpMeterProvider,
	exportRun,
	recordRun,
	shutdownTelemetry,
	type OtlpTransport,
	type TraceRunPayload,
} from "@fluxify/common/otlp";
import {
	observabilityIntegrationsCache,
	ownsIntegration,
} from "../../loaders/integrationsLoader";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";

/**
 * Telemetry export, run inside the execution process.
 *
 * Runs are exported straight from the process that recorded them, using the
 * project config it already holds — no IPC, no NATS, no separate worker. The
 * destination credentials are the same observability integrations log blocks
 * already use in this process, so this adds no new credential exposure.
 *
 * Execution recording (the portal's run history) is a different sink and needs
 * its own NATS stream when it is built; telemetry no longer has one.
 */

/**
 * Hands a completed run to the batch processor; the network export happens
 * later, off the request path. A crash or watchdog kill loses whatever is still
 * queued — accepted for telemetry. SIGTERM flushes via `resetProviders`.
 *
 * Resolved per run, not at record time: the project's integration can change
 * while the run is in flight.
 */
export function exportTraceRun(run: TraceRunPayload): void {
	try {
		const traces = resolveDestination(run.projectId, "traces");
		const metrics = resolveDestination(run.projectId, "metrics");
		if (traces) {
			exportRun(tracerFor(traces), run);
			logBlockErrors(run);
		}
		if (metrics) recordRun(meterFor(metrics), run);
	} catch (error) {
		// telemetry loss, never a failed request
		logger.error(
			`[telemetry] failed to export run ${run.runId}: ${String(error)}`,
			"TELEMETRY",
		);
	}
}

/**
 * Failed block spans also go to the project's logs destination, with the full
 * cause chain. No logs destination = nothing logged.
 */
function logBlockErrors(run: TraceRunPayload) {
	const failed = run.spans.filter((span) => span.error !== undefined);
	if (!failed.length) return;
	const integrationId = connectionIdFor(run.projectId, "logs");
	const config = observabilityIntegrationsCache[integrationId];
	if (!integrationId || !ownsIntegration(config, run.projectId)) return;

	const projectLogger = createObservabilityLogger(config.variant, {
		...config,
		projectId: run.projectId,
		routeId: run.routeId ?? run.workflowId,
	});
	for (const span of failed) {
		projectLogger?.logError(
			`run ${run.runId} block ${span.blockType} ${span.blockId} failed: ${span.error}`,
		);
	}
}

export type TelemetrySignal = "logs" | "traces" | "metrics";

export type Destination = {
	integrationId: string;
	baseUrl: string;
	headers: Record<string, string>;
	transport: OtlpTransport;
};

/**
 * `settings.ai.loggerConnectionId` is the original logs key. It was never
 * AI-specific — it is the project's log destination — so the telemetry keys
 * supersede it and it stays readable as a fallback for projects configured
 * before the split.
 */
const SETTING_KEYS = {
	logs: ["settings.telemetry.logsConnectionId", "settings.ai.loggerConnectionId"],
	traces: ["settings.telemetry.tracesConnectionId"],
	metrics: ["settings.telemetry.metricsConnectionId"],
} as const;

function connectionIdFor(projectId: string, signal: TelemetrySignal) {
	const settings = projectSettingsCache[projectId] as Record<string, string> | undefined;
	for (const key of SETTING_KEYS[signal]) {
		if (settings?.[key]) return settings[key];
	}
	return "";
}

/**
 * The integration a project's signal should be exported to, or null when it has
 * none — which is not an error, it is the normal state of an untraced project.
 *
 * The `ownsIntegration` guard is the cross-project credential boundary: the
 * cache is keyed by integration id alone, so indexing it directly would hand one
 * project another's endpoint and basic auth.
 */
export function resolveDestination(
	projectId: string,
	signal: TelemetrySignal,
): Destination | null {
	const integrationId = connectionIdFor(projectId, signal);
	if (!integrationId) return null;

	const config = observabilityIntegrationsCache[integrationId];
	if (!ownsIntegration(config, projectId)) return null;
	if (!config.baseUrl) return null;

	const auth =
		config.encodedBasicAuth ??
		(config.credentials?.username
			? btoa(`${config.credentials.username}:${config.credentials.password}`)
			: "");

	// the integration's own headers first — an api key or tenant id the ingestor
	// keys on — but never letting them clobber auth or stream routing below
	const headers: Record<string, string> = { ...(config.headers ?? {}) };
	if (auth) headers.Authorization = `Basic ${auth}`;
	// OpenObserve routes by this header and everything else ignores it. Not set
	// for metrics: OpenObserve ignores it there and names the stream after the
	// metric, so sending it would be a knob that silently does nothing.
	if (signal !== "metrics") headers["stream-name"] = `${signal}_${projectId}`;

	return {
		integrationId,
		baseUrl: String(config.baseUrl).replace(/\/$/, ""),
		headers,
		transport: {
			protocol: config.protocol,
			tlsMode: config.tlsMode,
			caCert: config.caCert,
			clientCert: config.clientCert,
			clientKey: config.clientKey,
		},
	};
}

/**
 * Live providers, keyed by destination. Each one owns a batch processor and a
 * socket pool, so an instance serving many projects has to cap them — a Map
 * iterates in insertion order, which makes the oldest entry the eviction
 * candidate for free.
 *
 * ponytail: insertion order, not true LRU. Re-key on hit if a hot destination
 * ever gets evicted by a burst of cold ones.
 */
// derived from the factories rather than imported from @opentelemetry/*: this
// package does not depend on the SDK directly and should not start to
type TracerProvider = ReturnType<typeof createOtlpTracerProvider>;
type MeterProvider = ReturnType<typeof createOtlpMeterProvider>;

const MAX_PROVIDERS = 32;
const tracers = new Map<string, TracerProvider>();
const meters = new Map<string, MeterProvider>();

function cacheKey(destination: Destination) {
	return `${destination.integrationId}|${destination.transport.protocol ?? "http"}|${destination.baseUrl}`;
}

function evict<T extends { shutdown(): Promise<unknown> }>(cache: Map<string, T>) {
	while (cache.size > MAX_PROVIDERS) {
		const oldest = cache.keys().next().value as string;
		const provider = cache.get(oldest)!;
		cache.delete(oldest);
		shutdownTelemetry(provider as never).catch(() => {});
	}
}

export function tracerFor(destination: Destination): TracerProvider {
	const key = cacheKey(destination);
	const existing = tracers.get(key);
	if (existing) return existing;

	const provider = createOtlpTracerProvider({
		url: destination.baseUrl,
		headers: destination.headers,
		transport: destination.transport,
		serviceName: "fluxify.route",
	});
	tracers.set(key, provider);
	evict(tracers);
	return provider;
}

export function meterFor(destination: Destination): MeterProvider {
	const key = cacheKey(destination);
	const existing = meters.get(key);
	if (existing) return existing;

	const provider = createOtlpMeterProvider({
		url: destination.baseUrl,
		headers: destination.headers,
		transport: destination.transport,
		serviceName: "fluxify.route",
	});
	meters.set(key, provider);
	evict(meters);
	return provider;
}

/**
 * Drop every provider. Called when integrations change — a rotated credential
 * or a moved endpoint must not keep exporting through the old connection.
 */
export async function resetProviders() {
	const all = [...tracers.values(), ...meters.values()];
	tracers.clear();
	meters.clear();
	await Promise.all(
		all.map((provider) =>
			shutdownTelemetry(provider as never).catch((error) =>
				logger.error(`[telemetry] provider shutdown: ${String(error)}`, "TELEMETRY"),
			),
		),
	);
}

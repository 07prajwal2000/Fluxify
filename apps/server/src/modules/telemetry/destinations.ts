import { logger } from "@fluxify/common";
import {
	createOtlpTracerProvider,
	createOtlpMeterProvider,
	shutdownTelemetry,
} from "@fluxify/common/otlp";
import { getProjectSetting } from "../../lib/project-settings";
import {
	observabilityIntegrationsCache,
	ownsIntegration,
} from "../../loaders/integrationsLoader";

export type TelemetrySignal = "logs" | "traces" | "metrics";

export type Destination = {
	integrationId: string;
	baseUrl: string;
	headers: Record<string, string>;
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

async function connectionIdFor(projectId: string, signal: TelemetrySignal) {
	for (const key of SETTING_KEYS[signal]) {
		const value = await getProjectSetting(projectId, key as never);
		if (value) return value;
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
export async function resolveDestination(
	projectId: string,
	signal: TelemetrySignal,
): Promise<Destination | null> {
	const integrationId = await connectionIdFor(projectId, signal);
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
	return `${destination.integrationId}|${destination.baseUrl}`;
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

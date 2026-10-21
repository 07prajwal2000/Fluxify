/**
 * Observability logger adapter interface.
 * Implemented by Loki, OpenTelemetry, and other telemetry providers.
 */
export interface ObservabilityAdapter {
	logInfo(value: any): void;
	logWarn(value: any): void;
	logError(value: any): void;
}

export type IObservabilityAdapter = ObservabilityAdapter;

type ConfigType = Map<string, string | number | boolean> | Record<string, any>;

function readConfig(cfg: ConfigType, key: string) {
	return cfg instanceof Map ? cfg.get(key) : cfg[key];
}

/**
 * Resolves user-supplied extra headers, dereferencing `cfg:` values from app config.
 * Dropped if missing/empty to avoid sending bad credentials.
 */
export function resolveCustomHeaders(
	headers: Record<string, string> | undefined,
	appConfig: ConfigType,
): Record<string, string> {
	if (!headers) return {};
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (!key) continue;
		const actual = value?.startsWith("cfg:") ? readConfig(appConfig, value.substring(4)) : value;
		if (actual === undefined || actual === null || actual === "") continue;
		resolved[key] = String(actual);
	}
	return resolved;
}

/** Inspect/metadata shape for observability integrations. */
export type ObservabilityInspectResult = {
	signals?: string[];
	streams?: string[];
};

export type ObservabilityMetadata = ObservabilityInspectResult;

type ConfigType = Map<string, string | number | boolean> | Record<string, any>;

function readConfig(cfg: ConfigType, key: string) {
	return cfg instanceof Map ? cfg.get(key) : cfg[key];
}

/**
 * Resolves the user's extra OTLP/Loki headers, dereferencing `cfg:` values the
 * same way credentials are.
 *
 * These exist because plenty of ingestors key on something other than basic
 * auth — an api key, a tenant id, a dataset name — and hardcoding one header per
 * vendor does not scale.
 *
 * A `cfg:` reference that resolves to nothing is **dropped, not sent empty**: an
 * empty api key header reads to the receiving end as a real credential that
 * happens to be wrong, which is a much worse failure to debug than an absent one.
 */
export function resolveCustomHeaders(
	headers: Record<string, string> | undefined,
	appConfig: ConfigType,
): Record<string, string> {
	if (!headers) return {};
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (!key) continue;
		const actual = value?.startsWith("cfg:")
			? readConfig(appConfig, value.substring(4))
			: value;
		if (actual === undefined || actual === null || actual === "") continue;
		resolved[key] = String(actual);
	}
	return resolved;
}

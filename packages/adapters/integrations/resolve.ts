import { logger } from "@fluxify/common";

/** `cfg:KEY` -> the app config value, anything else unchanged */
function expand(appConfig: Record<string, any> | undefined, value: unknown) {
	const text = value?.toString() ?? "";
	return text.startsWith("cfg:") ? appConfig?.[text.slice(4)] : value;
}

/**
 * A stored config -> connection details, `cfg:` references expanded. The
 * default `resolve` of a variant that declares none.
 *
 * The expansion goes into a NEW object and is never written back onto `config`.
 * The test runner resolves the same row twice — once against the live app
 * config, once against the overridden one — and a row whose `cfg:` reference had
 * been overwritten by the first pass would silently keep the first pass's value.
 */
export function expandStoredConfig(
	appConfig: Record<string, any> | undefined,
	config: Record<string, string>,
	parseUrl: (url: string) => any = () => null,
) {
	const connectionDetails = {} as any;
	if (config.source === "url") {
		// missing cfg key -> "" -> no match -> logged, rather than a TypeError
		const parsed = parseUrl(String(expand(appConfig, config.url) ?? ""));
		if (parsed) return parsed;
		logger.info("Failed to load integration");
		return connectionDetails;
	}
	for (const key in config) {
		connectionDetails[key] = expand(appConfig, config[key]);
	}
	return connectionDetails;
}

export function appConfigMap(config: Record<string, any> | undefined) {
	const map = new Map<string, string>();
	for (const key in config) {
		map.set(key, config[key]);
	}
	return map;
}

/** Every app config key a stored config references (`cfg:KEY`), nested values included. */
export function appConfigKeys(config: unknown) {
	if (typeof config !== "object" || config === null) return [];
	const keys = [] as string[];
	const q = [config] as any[];

	while (q.length > 0) {
		const obj = q.shift()!;
		for (const key in obj) {
			const value = obj[key];
			if (typeof value === "object") {
				q.push(value);
			}
			if (typeof value === "string" && value.startsWith("cfg:")) {
				keys.push(value.slice(4));
			}
		}
	}
	return keys;
}

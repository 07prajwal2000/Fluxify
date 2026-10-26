import { createObservabilityLogger } from "@fluxify/adapters";
import { type AbstractLogger, ConsoleLoggerProvider } from "@fluxify/lib";
import { observabilityIntegrationsCache, ownsIntegration } from "../../loaders/integrationsLoader";

/**
 * The logger for one integration id, or the server console when the id is empty,
 * unknown, or owned by another project. Shared by the JS `logger` api and the
 * cloud logs block so both resolve a destination the same way.
 *
 * The config is spread, never mutated: the cache entry is shared by every
 * in-flight request, so writing route ids into it cross-labels concurrent logs.
 * A provider is still built per call — that lifecycle is #204, not this.
 */
export function observabilityLoggerFor(
	connectionId: string,
	projectId: string,
	routeId: string,
): AbstractLogger {
	const config = observabilityIntegrationsCache[connectionId];
	if (!ownsIntegration(config, projectId)) {
		return new ConsoleLoggerProvider(routeId);
	}
	return createObservabilityLogger(config.variant, {
		...config,
		projectId,
		routeId,
	})!;
}

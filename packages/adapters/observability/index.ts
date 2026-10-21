import type { ObservabilityAdapter } from "@fluxify/sdk/integrations";
import { configOwner, integrationRegistry } from "../integrations";

/** Resolves through the registry, so a row still named "Open Telemetry Logs" gets the same logger. */
export function createObservabilityLogger(variant: string, config: any): ObservabilityAdapter {
	const def = integrationRegistry.require("observability", variant, configOwner(config));
	if (!def.create) throw new Error(`${variant} cannot be created`);
	return def.create(config, {});
}

export type { IObservabilityAdapter, ObservabilityAdapter } from "@fluxify/sdk/integrations";
export * from "./loki";
export * from "./openTelemetryLogs";

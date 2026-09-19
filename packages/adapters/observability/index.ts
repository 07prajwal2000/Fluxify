import { LokiLogger } from "./loki";
import { OpenTelemetryLogs } from "./openTelemetryLogs";

export function createObservabilityLogger(variant: string, config: any) {
	if (variant === LokiLogger.variant) {
		return new LokiLogger(config);
	} else if (variant === OpenTelemetryLogs.variant) {
		return new OpenTelemetryLogs(config);
	}
	throw new Error("Invalid generic provider variant: " + variant);
}

export * from "./loki";
export * from "./openTelemetryLogs";

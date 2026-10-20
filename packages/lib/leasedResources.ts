import { logger } from "@fluxify/common";
import { LeasedResources as Base, type LeasedResourcesOptions } from "@fluxify/sdk/runtime";

// The class lives in the SDK so the plugin test harness pools exactly like a worker.
export {
	DEFAULT_IDLE_TIMEOUT_MS,
	type LeasedResourcesOptions,
	type ResourceLease,
	type ResourceSpec,
	type ResourceTimer,
} from "@fluxify/sdk/runtime";

const onCloseError = (slot: string, error: unknown) =>
	logger.error("Failed to close a pooled resource", "LIB.leasedResources", {
		slot,
		error: error instanceof Error ? error.message : String(error),
	});

/** `LeasedResources` that logs a failed close through the engine's logger */
export class LeasedResources<T> extends Base<T> {
	constructor(options: LeasedResourcesOptions = {}) {
		super({ onCloseError, ...options });
	}
}

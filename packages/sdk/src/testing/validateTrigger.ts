import type { Params } from "../params.js";
import type { TriggerDefinition } from "../trigger.js";
import type { LogEntry } from "./fakes.js";
import { type RunTriggerOptions, testContext, within } from "./runTrigger.js";

export type ValidateTriggerResult = {
	/** what `validate` returned; empty when it returned nothing or the trigger has none */
	warnings: string[];
	logs: LogEntry[];
};

/**
 * Runs a trigger's `validate` with no Fluxify runtime, with the params,
 * integrations and app config a save would hand it. Rejects with the error
 * `validate` throws (the message the user would see), or when it hangs past
 * `timeoutMs`, which also aborts `ctx.signal`.
 */
export async function validateTrigger<P extends Params>(
	def: TriggerDefinition<P>,
	options: RunTriggerOptions<P> = {},
): Promise<ValidateTriggerResult> {
	const { name, ms, logs, logger, params, pooled, leases, getConfig, integrations } = testContext(
		def,
		options,
	);
	const controller = new AbortController();
	try {
		const result = def.validate
			? await within(
					def.validate({
						params: params as never,
						integrations,
						getConfig,
						logger,
						signal: controller.signal,
					}),
					ms,
					`trigger ${name}: validate() did not resolve`,
				)
			: undefined;
		if (result !== undefined && !isStrings(result))
			throw new Error(`trigger ${name}: validate() must resolve to nothing or an array of strings`);
		return { warnings: result ?? [], logs };
	} finally {
		controller.abort();
		leases.release();
		if (!options.pool) await pooled.close();
	}
}

const isStrings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((v) => typeof v === "string");

import { z } from "zod";
import { type CheckVisible, placeParams, prepareParams } from "./block.js";
import { type TriggerEntry, triggerEntrySchema } from "./manifest.js";
import type { Params } from "./params.js";
import type { TriggerContext } from "./runtime/trigger.js";
import { BLOCK_ONLY_FIELDS } from "./validateTrigger.js";

export type TriggerDefinition<P extends Params = Params> = {
	/** `scope/name/<path>`, like a block's type: the plugin name plus its path under `src/triggers` */
	name: string;
	label: string;
	description?: string;
	/** a path inside the plugin, e.g. `./icons/poll.svg` */
	icon: string;
	/**
	 * What `ctx` may reach; the user approves it. An `integration` param needs
	 * its kind here, an `appconfig` param needs `appconfig`.
	 */
	permissions?: { integrations?: string[]; appconfig?: boolean };
	/** the same `param.*` builders as a block's, plus `param.secret()`; nothing evaluated per request */
	params?: P;
	/** the wizard's steps in order; default: in order of first use, General first */
	tabs?: readonly string[];
	/**
	 * Fluxify retries a failed run by the trigger's Attempts setting before
	 * `emit` rejects. Off: one run per `emit`, and retrying is yours.
	 */
	retry?: boolean;
	/**
	 * Opens the listener or the poll loop and resolves once it is running; keep
	 * the loop going in the background, and end it when `ctx.signal` aborts.
	 * Idempotency, batching, commits and coordinating replicas are yours: every
	 * worker of the trigger's group runs `start`.
	 *
	 * Returns this instance's stop function, which closes what this call opened.
	 * One definition can run as several triggers at once, each with its own
	 * `ctx`, so the cleanup lives in the closure. Fluxify calls it after
	 * `ctx.signal` aborts, and it must return. Nothing to close: `async () => {}`.
	 */
	start(ctx: TriggerContext<P>): Promise<() => Promise<void>>;
};

/** any `trigger(...)` result */
export type AnyTrigger = TriggerDefinition<any>;

/** The definition minus `start`, as manifest data. */
export function toTriggerEntry(def: AnyTrigger): TriggerEntry {
	const entry = {
		name: def.name,
		label: def.label,
		description: def.description,
		icon: def.icon,
		permissions: def.permissions ?? {},
		...placeParams(def),
		retry: !!def.retry,
	};
	return JSON.parse(JSON.stringify(entry));
}

/**
 * Defines a plugin trigger. Default-export the result from a file under
 * `src/triggers`. Throws on an invalid definition, naming it: params as a
 * block's are checked, a missing `start`, a leftover `stop`, and a block-only field.
 */
export function trigger<const P extends Params = {}>(
	def: TriggerDefinition<P> & { params?: NoInfer<CheckVisible<P>> },
): TriggerDefinition<P> {
	const fail = (message: string) => new Error(`trigger ${String(def.name)}: ${message}`);
	if (typeof def.start !== "function") throw fail("start() is required");
	if ("stop" in def) throw fail("stop() is gone: return the stop function from start()");
	const blockOnly = BLOCK_ONLY_FIELDS.filter((f) => f in def);
	if (blockOnly.length) throw fail(`${blockOnly.join(", ")} belong to a block, not a trigger`);
	const parsed = triggerEntrySchema.safeParse(toTriggerEntry(def));
	if (!parsed.success) throw fail(z.prettifyError(parsed.error));
	const params = (def.params ?? {}) as Params;
	return {
		...def,
		start: (ctx) => def.start({ ...ctx, params: prepareParams(params, ctx.params) as never }),
	};
}

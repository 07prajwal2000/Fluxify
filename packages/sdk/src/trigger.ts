import { z } from "zod";
import { type CheckVisible, placeParams, prepareParams } from "./block.js";
import type { LagEntry } from "./lag.js";
import { type TriggerEntry, triggerEntrySchema } from "./manifest.js";
import type { Params } from "./params.js";
import type {
	TriggerContext,
	TriggerLagContext,
	TriggerValidateContext,
} from "./runtime/trigger.js";
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
	/**
	 * Optional. Checks the settings before Fluxify saves the trigger: when it is
	 * created, turned on, or its params change. Throw to refuse the save with
	 * that message; return strings to save with them as warnings. Runs on a
	 * development worker, with the development integrations and app config.
	 */
	validate?(ctx: TriggerValidateContext<P>): Promise<void | string[]>;
	/**
	 * Optional. Lets the trigger's claim scale on its backlog. Fluxify calls `read`
	 * every few seconds on each worker running the trigger and gives KEDA the last
	 * number; a read that throws, times out or returns something that is not a
	 * number is "unknown", never 0. The trigger form then asks for **Lag per
	 * worker**: how much backlog one worker clears, in the unit `helpText` names.
	 * Replicas follow `ceil(lag / lagPerWorker)` between the claim's min and max.
	 */
	lag?: {
		/** The source's current backlog as a number of at least 0: the whole source's, not this worker's share. */
		read(ctx: TriggerLagContext<P>): Promise<number>;
		/** What the form fills in when the user sets nothing: a whole number of at least 1. Without it the field is required. */
		default?: number;
		/** Shown under the field, in plain text on one line (200 characters): name the unit, e.g. "Pending rows one worker clears per poll". */
		helpText: string;
	};
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
		validate: !!def.validate,
		lag: def.lag && ({ default: def.lag.default, helpText: def.lag.helpText } satisfies LagEntry),
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
	if (def.validate !== undefined && typeof def.validate !== "function")
		throw fail("validate must be a function");
	if (def.lag !== undefined && (typeof def.lag !== "object" || typeof def.lag?.read !== "function"))
		throw fail("lag must be { read(ctx), helpText, default? }");
	const params = (def.params ?? {}) as Params;
	const prepared = <C extends { params: unknown }>(ctx: C): C => ({
		...ctx,
		params: prepareParams(params, ctx.params as never) as never,
	});
	const { validate, lag } = def;
	return {
		...def,
		start: (ctx) => def.start(prepared(ctx)),
		...(validate ? { validate: (ctx) => validate(prepared(ctx)) } : {}),
		...(lag ? { lag: { ...lag, read: (ctx) => lag.read(prepared(ctx)) } } : {}),
	};
}

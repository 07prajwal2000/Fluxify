import type { IntegrationsContext, Logger } from "../context.js";
import { secretKey } from "../integration.js";
import type { Params, ParamValues } from "../params.js";

/**
 * Where a batch came from, bound to that batch: what a workflow sees as
 * `trigger.connection`. The built-in queue triggers hand one out in manual
 * commit mode; a plugin trigger hands its own to `ctx.emit`, and a JS block's
 * `trigger.connection.commit()` calls the author's function (the run is in
 * the same process). `raw` is the source's own client.
 */
export interface TriggerConnection {
	raw: unknown;
	/** Marks this batch processed. Automatic after success unless the trigger commits manually. */
	commit(): Promise<void>;
	/** Parks this batch on the integration's dead-letter destination. */
	moveToDLQ(error?: unknown): Promise<void>;
	/** Messages waiting behind the committed offset, or null if unknown. */
	lag(): Promise<number | null>;
}

export type EmitOptions = {
	/** handed to the workflow as `trigger.connection` */
	connection?: TriggerConnection;
};

/** What a plugin trigger's `start` gets as `ctx`. */
export interface TriggerContext<P extends Params = Params> {
	/** the trigger's params, defaulted and checked as a block's are */
	params: ParamValues<P>;
	/** the integrations this trigger was granted (`permissions.integrations`), by id */
	integrations: IntegrationsContext;
	/**
	 * An app config value: any key with `permissions.appconfig`, else only the
	 * keys the trigger's own `param.secret()` fields name. Any other key throws
	 * `PermissionDeniedError` and reads nothing, and Fluxify turns the trigger off
	 * at once, even if your code catches the error: only a newly approved version
	 * can fix it. Errors name the key, never a value.
	 */
	getConfig(key: string): string | number | boolean;
	logger: Logger;
	/** aborted when Fluxify stops the trigger, before it calls the function `start` returned */
	signal: AbortSignal;
	/**
	 * Runs the attached workflow once with `events`, one item per event (the
	 * workflow's `trigger.data`), in this process. Resolves when the run
	 * succeeds and rejects when it fails. With `retry: true` it rejects only
	 * after the trigger's Attempts setting is used up; without it there is one
	 * run per call, and retrying is yours. Commit only after it resolves.
	 * Once the instance stopped, it rejects without running.
	 */
	emit(events: unknown[], options?: EmitOptions): Promise<void>;
	/**
	 * Reports a fatal error from your own background loop, which Fluxify cannot
	 * see otherwise. The instance stops (`ctx.signal` aborts, then your stop
	 * function runs) and starts again after a backoff; after repeated failures
	 * the trigger is turned off with this error's message as the reason.
	 */
	fail(error: unknown): void;
	/**
	 * Tells Fluxify how a round of your loop went: with an error it failed, with
	 * nothing it worked. Enough failed rounds in a row turn the trigger off, with
	 * no restarts in between. `poll` calls it for you; a hand-written loop may.
	 */
	reportTick(error?: unknown): void;
}

/**
 * What a plugin trigger's `validate` gets as `ctx`: `start`'s, minus what only
 * a running instance has. `signal` aborts when the check runs out of time.
 */
export type TriggerValidateContext<P extends Params = Params> = Pick<
	TriggerContext<P>,
	"params" | "integrations" | "getConfig" | "logger" | "signal"
>;

/**
 * What a plugin trigger's `lag.read` gets as `ctx`: the running instance's, so
 * it reuses the connections `start` opened, minus `emit` and `fail`: it only
 * measures. `signal` aborts when the trigger stops or the read runs out of time.
 */
export type TriggerLagContext<P extends Params = Params> = TriggerValidateContext<P>;

/**
 * What `ctx.getConfig` throws for a key the trigger may not read. It never fixes
 * itself, so the trigger is turned off at the first one.
 */
export class PermissionDeniedError extends Error {
	override name = "PermissionDeniedError";
}

/** `getConfig` that also reports a denial, so an author's `catch` cannot hide it */
export const failingOnDenial =
	<V>(getConfig: (key: string) => V, denied: (error: unknown) => void) =>
	(key: string) => {
		try {
			return getConfig(key);
		} catch (error) {
			if (error instanceof PermissionDeniedError) denied(error);
			throw error;
		}
	};

const CONNECTION_METHODS = ["commit", "moveToDLQ", "lag"] as const;

/** Throws when `emit` got something other than an array of events, or a connection missing a method. */
export function checkEmit(name: string, events: unknown, options?: EmitOptions) {
	if (!Array.isArray(events))
		throw new TypeError(`trigger ${name}: emit(events) takes an array, one item per event`);
	const connection = options?.connection as Record<string, unknown> | undefined;
	if (connection === undefined) return;
	const missing = CONNECTION_METHODS.filter((m) => typeof connection?.[m] !== "function");
	if (missing.length)
		throw new TypeError(`trigger ${name}: emit's connection needs ${missing.join(", ")}()`);
}

/** the names of the secret params in `params`, sorted, to compare code with its manifest */
export const secretParamNames = (params: Params = {}) =>
	Object.keys(params)
		.filter((name) => params[name]!.type === "secret")
		.sort();

/** the app config keys a trigger's secret params name (a stored `cfg:<KEY>` or a bare key) */
export const triggerSecretKeys = (trigger: { params?: Params }, params: Record<string, unknown>) =>
	Object.entries(trigger.params ?? {})
		.filter(([k, p]) => p.type === "secret" && typeof params[k] === "string")
		.map(([k]) => secretKey(params[k] as string));

/**
 * `ctx.getConfig` for one trigger: every key when it was granted app config,
 * else the keys its secret params name. Takes the key or a secret param's
 * stored value (`cfg:<KEY>`), so `ctx.getConfig(ctx.params.token)` works.
 */
export function triggerGetConfig(
	name: string,
	trigger: { params?: Params; permissions?: { appconfig?: boolean } },
	params: Record<string, unknown>,
	appConfig: Record<string, string | number | boolean | undefined>,
) {
	const own = new Set(triggerSecretKeys(trigger, params));
	return (stored: string) => {
		const key = secretKey(stored);
		if (!trigger.permissions?.appconfig && !own.has(key))
			throw new PermissionDeniedError(
				`trigger ${name}: getConfig('${key}') is not allowed; it reads the keys its secret params name, or any key with permissions.appconfig`,
			);
		const value = appConfig[key];
		if (value === undefined || value === null)
			throw new Error(`trigger ${name}: app config key '${key}' has no value in this environment`);
		return value;
	};
}

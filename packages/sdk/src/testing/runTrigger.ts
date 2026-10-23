import type { BlockVars, Logger } from "../context.js";
import type { Params } from "../params.js";
import { grantContext } from "../runtime/contract.js";
import { leasePool } from "../runtime/ctx.js";
import {
	checkEmit,
	type TriggerConnection,
	type TriggerContext,
	triggerGetConfig,
} from "../runtime/trigger.js";
import type { TriggerDefinition } from "../trigger.js";
import { type LogEntry, recordingLogger, type TestPool, testPool } from "./fakes.js";
import { type FakeIntegration, fakeIntegrations, type InputParams } from "./runBlock.js";

export type RunTriggerOptions<P extends Params> = {
	/** the params as the wizard stores them; a secret holds its app config key */
	params?: InputParams<P>;
	/** what `ctx.integrations.get(id)` returns, by id, as in `runBlock`'s ctx */
	integrations?: Record<string, FakeIntegration>;
	/** the environment's app config, by key, for `ctx.getConfig` */
	appConfig?: Record<string, string | number | boolean>;
	logger?: Logger;
	/** pooled integration clients; share one `testPool()` to see reuse. Default: fresh per run */
	pool?: TestPool;
	/** how long `start` may take to resolve and the returned stop function to return; default 5000 ms */
	timeoutMs?: number;
};

/** one `ctx.emit` call, pending until the test settles it as the workflow run would */
export type EmitCall = {
	events: unknown[];
	connection?: TriggerConnection;
	settled: boolean;
	/** the run succeeded: `emit` resolves */
	resolve(): void;
	/** the run failed: `emit` rejects with `error` */
	reject(error?: unknown): void;
};

export type TriggerRun = {
	/** every `emit` so far, in call order */
	emits: EmitCall[];
	/** the next `emit` not yet returned by this; rejects after `timeoutMs` */
	nextEmit(timeoutMs?: number): Promise<EmitCall>;
	logs: LogEntry[];
	/** the `ctx.signal` the trigger got */
	signal: AbortSignal;
	/**
	 * The definition's `retry` flag. The harness does not simulate attempts:
	 * each `emit` is one call to settle, whatever `retry` says. With `retry`
	 * on, a rejection here stands for the last attempt failing.
	 */
	retry: boolean;
	/** what the trigger passed to `ctx.fail`, if it did; the instance is then stopped */
	readonly failure: Error | undefined;
	/** the next `ctx.fail`, once the instance it stopped has closed; rejects after `timeoutMs` */
	failed(timeoutMs?: number): Promise<Error>;
	/**
	 * Aborts `ctx.signal`, then awaits the function `start` returned; rejects
	 * when it does not return within `timeoutMs`. After `ctx.fail` it awaits
	 * that stop instead of running a second one.
	 */
	stop(): Promise<void>;
};

/** `promise`, or a rejection naming `what` after `ms` */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${what} within ${ms} ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** records each `emit` and hands it out to `nextEmit` callers, in order; refused once `stopped()` */
function emitRecorder(name: string, stopped: () => boolean) {
	const emits: EmitCall[] = [];
	const waiting: ((call: EmitCall) => void)[] = [];
	let handed = 0;
	const emit: TriggerContext["emit"] = async (events, options) => {
		checkEmit(name, events, options);
		if (stopped()) throw new Error(`trigger ${name} is no longer running`);
		return new Promise<void>((resolve, reject) => {
			const call: EmitCall = {
				events,
				...(options?.connection ? { connection: options.connection } : {}),
				settled: false,
				resolve: () => settle(() => resolve()),
				reject: (error = new Error("workflow run failed")) => settle(() => reject(error)),
			};
			const settle = (done: () => void) => {
				if (call.settled) throw new Error("this emit is already settled");
				call.settled = true;
				done();
			};
			emits.push(call);
			if (waiting.length) {
				handed++;
				waiting.shift()!(call);
			}
		});
	};
	const nextEmit = (ms = 5000) => {
		if (handed < emits.length) return Promise.resolve(emits[handed++]!);
		return within(new Promise<EmitCall>((r) => waiting.push(r)), ms, `trigger ${name}: no emit`);
	};
	return { emits, emit, nextEmit };
}

/**
 * Runs a trigger with no Fluxify runtime: `start` gets its params (defaulted
 * and checked), the granted integrations and app config, and an `emit` that
 * records each call for the test to resolve or reject, as the workflow run
 * would. Resolves once `start` has; rejects when `start` throws or hangs.
 */
export async function runTrigger<P extends Params>(
	def: TriggerDefinition<P>,
	options: RunTriggerOptions<P> = {},
): Promise<TriggerRun> {
	const name = def.name;
	const ms = options.timeoutMs ?? 5000;
	const logs: LogEntry[] = [];
	const logger = options.logger ?? recordingLogger(logs);
	const params = (options.params ?? {}) as Record<string, unknown>;
	const pooled = options.pool ?? testPool();
	const leases = leasePool(pooled, ["integrations"]);
	const getConfig = triggerGetConfig(name, def, params, options.appConfig ?? {});
	// a test grants what the trigger declares, the way a user approves it
	const { integrations } = grantContext(
		{
			vars: { getConfig } as unknown as BlockVars,
			integrations: fakeIntegrations(options.integrations ?? {}, leases.pool),
		},
		{ integrations: def.permissions?.integrations ?? [], appconfig: true },
		`trigger ${name}`,
	);
	const controller = new AbortController();
	let failure: Error | undefined;
	let halting: Promise<void> | undefined;
	let stopInstance: (() => Promise<void>) | undefined;
	const failedWaiters: (() => void)[] = [];
	// one stop per instance, whether `stop()` or `ctx.fail` asked first
	const halt = () =>
		(halting ??= (async () => {
			controller.abort();
			try {
				await within(stopInstance!(), ms, `trigger ${name}: stop() did not return`);
			} finally {
				leases.release();
				if (!options.pool) await pooled.close();
			}
		})());
	const recorder = emitRecorder(name, () => controller.signal.aborted);
	const fail = (error: unknown) => {
		if (failure || halting) return;
		failure = error instanceof Error ? error : new Error(String(error));
		// before `start` resolved there is nothing to stop yet; it stops once it has
		if (stopInstance)
			void halt().then(
				() => {
					for (const w of failedWaiters.splice(0)) w();
				},
				() => {},
			);
	};
	stopInstance = await within(
		def.start({
			params: params as never,
			integrations: integrations!,
			getConfig,
			logger,
			signal: controller.signal,
			emit: recorder.emit,
			fail,
		}),
		ms,
		`trigger ${name}: start() did not resolve`,
	);
	if (typeof stopInstance !== "function")
		throw new Error(`trigger ${name}: start() must resolve to its stop function`);
	if (failure) await halt();
	return {
		emits: recorder.emits,
		nextEmit: recorder.nextEmit,
		logs,
		signal: controller.signal,
		retry: !!def.retry,
		get failure() {
			return failure;
		},
		async failed(timeoutMs = ms) {
			if (!failure || !halting)
				await within(
					new Promise<void>((r) => failedWaiters.push(r)),
					timeoutMs,
					`trigger ${name}: no ctx.fail`,
				);
			else await halting;
			return failure!;
		},
		stop: halt,
	};
}

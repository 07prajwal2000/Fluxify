import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { logger, MissingEnvValueError } from "@fluxify/common";
import { backoffMs } from "@fluxify/common/nats";
import type { TriggerArtifact } from "../compiler/artifacts";
import { provideHostPackages } from "../requestRouter/hostPackages";
import { type PluginTriggerRef, pluginTriggerRef } from "../requestRouter/pluginTriggers";
import { openContext, resolvedInputs, type TriggerModule } from "./pluginTriggerContext";
import { reportTriggerFault } from "./queueRuntime";
import { type StrayOwner, trackOwner, triggerScope } from "./strayErrors";
import { isPluginTriggerType, pluginTriggerKind } from "./types";

/**
 * Plugin triggers, run inside the execution process beside the queue triggers.
 *
 * The supervisor forwards a trigger artifact only to the workers of its group,
 * so whatever arrives here runs here: one instance per trigger row, keyed by
 * trigger id, several of one kind side by side. Its plugin's `start` gets a
 * `ctx`, and resolves to that instance's stop function.
 *
 * Delivery is the author's (idempotency, batching, commits, replicas). What
 * this owns is keeping one broken trigger from hurting anything else: a crash
 * (`start` throws, `ctx.fail`, an error traced to it, a hung stop) stops the
 * instance and starts it again after a backoff, and after `maxFailures` in a
 * row the trigger is reported, which turns it off with the reason.
 */

const TAG = "TRIGGERS.plugin";

/** how a crashing trigger is restarted and when it is given up on; tests shorten them */
export const pluginTriggerLimits = {
	/** consecutive failures before the trigger is turned off */
	maxFailures: 5,
	/** the first restart's wait, doubling per failure (`backoffMs`, capped at 5 minutes) */
	retryDelayMs: 1_000,
	startTimeoutMs: 30_000,
	stopTimeoutMs: 10_000,
	/** up this long, a trigger's next failure counts from one again */
	stableMs: 60_000,
};

type Instance = {
	controller: AbortController;
	def: TriggerModule;
	ref: PluginTriggerRef;
	fingerprint: string;
	/** set once `start` resolved to it */
	stop?: () => Promise<void>;
	release?: () => void;
	untrack?: () => void;
	startedAt?: number;
	stopped: boolean;
};

type Slot = {
	artifact: TriggerArtifact;
	/** the artifact minus its publish time: the same one sent again is not a change */
	key: string;
	instance?: Instance;
	failures: number;
	lastFailure?: string;
	/** a restart waiting out its backoff */
	retry?: ReturnType<typeof setTimeout>;
	/** one operation at a time per trigger: start, stop and restart never overlap */
	queue: Promise<void>;
};

const slots = new Map<string, Slot>();
/** by entry path: ESM cannot be unloaded, a new plugin version comes with a new process */
const modules = new Map<string, Promise<TriggerModule>>();

const TIMEOUT = Symbol("timeout");
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const seconds = (ms: number) => `${ms / 1000}s`;

function within<T>(promise: Promise<T>, ms: number) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<typeof TIMEOUT>((r) => {
		timer = setTimeout(() => r(TIMEOUT), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function enqueue(slot: Slot, op: () => Promise<unknown>) {
	slot.queue = slot.queue.then(op).then(
		() => {},
		(error) => logger.error(`[triggers] ${slot.artifact.triggerId}: ${String(error)}`, TAG),
	);
	return slot.queue;
}

/** A trigger artifact arriving, changing or being withdrawn. Ignores every other type. */
export function applyPluginTrigger(triggerId: string, artifact: TriggerArtifact | null) {
	if (artifact && !isPluginTriggerType(artifact.type)) return Promise.resolve();
	let slot = slots.get(triggerId);
	if (!artifact) {
		if (!slot) return Promise.resolve();
		slots.delete(triggerId);
		clearTimeout(slot.retry);
		return enqueue(slot, () => halt(slot!, "withdrawn"));
	}
	const { publishedAt: _, ...content } = artifact;
	const key = JSON.stringify(content);
	// a group reassignment sends every artifact again; a running one stays as it is
	if (slot?.key === key && (slot.instance || slot.retry)) return slot.queue;
	slot ??= { artifact, key, failures: 0, queue: Promise.resolve() };
	clearTimeout(slot.retry);
	Object.assign(slot, { artifact, key, failures: 0, retry: undefined });
	slots.set(triggerId, slot);
	const changed = slot;
	return enqueue(changed, () => restart(changed));
}

/**
 * Re-reads every trigger's secrets and integration configs after project
 * config changed. Unchanged ones are left alone; changed ones restart, and one
 * left with no value in this environment stops. One that never started (its
 * plugin or a value was missing) is tried again.
 */
export function refreshPluginTriggers() {
	return Promise.allSettled([...slots.values()].map((slot) => enqueue(slot, () => refresh(slot))));
}

export async function shutdownPluginTriggers() {
	const all = [...slots.values()];
	slots.clear();
	await Promise.allSettled(
		all.map((slot) => {
			clearTimeout(slot.retry);
			return enqueue(slot, () => halt(slot, "shutting down"));
		}),
	);
}

/** for tests and status: whether it runs, and its failures in a row */
export function pluginTriggerStatus(triggerId: string) {
	const slot = slots.get(triggerId);
	const instance = slot?.instance;
	return (
		slot && {
			running: !!instance?.stop && !instance.stopped,
			failures: slot.failures,
			lastFailure: slot.lastFailure,
		}
	);
}

export const hasPluginTrigger = (triggerId: string) => !!pluginTriggerStatus(triggerId)?.running;

async function refresh(slot: Slot) {
	if (slot.retry || slots.get(slot.artifact.triggerId) !== slot) return;
	const instance = slot.instance;
	if (!instance) return start(slot);
	let fingerprint: string;
	try {
		fingerprint = resolvedInputs(slot.artifact, instance.ref, instance.def);
	} catch (error) {
		if (!(error instanceof MissingEnvValueError)) throw error;
		logger.warn(`[triggers] ${slot.artifact.triggerId} stopping: ${error.message}`, TAG);
		return halt(slot, "a value went missing");
	}
	if (fingerprint !== instance.fingerprint) return restart(slot);
}

async function restart(slot: Slot) {
	// a stop that hangs is a failure: it waits out a backoff like any other
	if (slot.instance && (await halt(slot, "restarting")))
		return recordFailure(
			slot,
			`stop timed out after ${seconds(pluginTriggerLimits.stopTimeoutMs)}`,
		);
	return start(slot);
}

/** stops the slot's instance; true when its stop function did not return in time */
function halt(slot: Slot, why: string) {
	const instance = slot.instance;
	slot.instance = undefined;
	return instance ? close(slot.artifact, instance, why) : Promise.resolve(false);
}

/** abort `ctx.signal`, then the stop function `start` returned, within the timeout */
async function close(artifact: TriggerArtifact, instance: Instance, why: string) {
	instance.stopped = true;
	instance.controller.abort();
	instance.untrack?.();
	let timedOut = false;
	try {
		if (instance.stop)
			timedOut = (await within(instance.stop(), pluginTriggerLimits.stopTimeoutMs)) === TIMEOUT;
		if (timedOut)
			logger.warn(
				`[triggers] ${artifact.triggerId} stop timed out after ${seconds(pluginTriggerLimits.stopTimeoutMs)}, dropped`,
				TAG,
			);
	} catch (error) {
		logger.warn(`[triggers] ${artifact.triggerId} stop failed: ${messageOf(error)}`, TAG);
	} finally {
		// whatever the stop function did, the instance's own pooled leases go
		instance.release?.();
	}
	logger.info(`[triggers] ${artifact.triggerId} stopped (${why})`, TAG);
	return timedOut;
}

async function start(slot: Slot) {
	const { artifact } = slot;
	// withdrawn while queued, or started meanwhile (a restart overtook a pending retry)
	if (slots.get(artifact.triggerId) !== slot || slot.instance) return;
	const ready = await prepare(slot);
	if (!ready) return;
	const instance: Instance = {
		...ready,
		controller: new AbortController(),
		stopped: false,
	};
	slot.instance = instance;
	const crash = (prefix: string) => (error: unknown) =>
		onFailure(slot, instance, `${prefix}: ${messageOf(error)}`);
	const owner: StrayOwner = {
		entry: ready.ref.entry,
		live: () => !instance.stopped,
		fail: crash("unhandled error"),
	};
	instance.untrack = trackOwner(owner);
	let starting: Promise<unknown> | undefined;
	let stop: unknown;
	try {
		const opened = openContext(artifact, ready.ref, ready.def, {
			signal: instance.controller.signal,
			fail: crash("ctx.fail"),
			stopped: () => instance.stopped,
		});
		instance.release = opened.release;
		// the author's code, and every callback it schedules, runs in the instance's scope
		starting = triggerScope.run(owner, () => ready.def.start(opened.ctx));
		stop = await within(starting, pluginTriggerLimits.startTimeoutMs);
	} catch (error) {
		return crash("start failed")(error);
	}
	if (stop === TIMEOUT) {
		// a start resolving after all hands back a stop function nobody else will call
		void starting!.then((late) => typeof late === "function" && late()).catch(() => {});
		return crash("start failed")(
			`it did not resolve within ${seconds(pluginTriggerLimits.startTimeoutMs)}`,
		);
	}
	if (typeof stop !== "function")
		return crash("start failed")("start() must resolve to its stop function");
	instance.stop = stop as () => Promise<void>;
	// a `ctx.fail` while starting already queued its stop, which now has the function
	if (instance.stopped) return;
	instance.startedAt = Date.now();
	logger.info(`[triggers] ${artifact.triggerId} started (${ready.def.name})`, TAG);
}

/**
 * The installed code for the artifact's kind, checked against the version the
 * artifact names, and its inputs resolved. Undefined when it must not start;
 * the reason is logged.
 */
async function prepare(slot: Slot) {
	const { artifact } = slot;
	const kind = pluginTriggerKind(artifact.type);
	const ref = pluginTriggerRef(artifact.projectId, kind);
	if (!ref) {
		logger.warn(
			`[triggers] ${artifact.triggerId} not starting: no installed plugin here provides ${kind}`,
			TAG,
		);
		return;
	}
	if (ref.integrity !== artifact.plugin?.integrity) {
		logger.error(
			`[triggers] ${artifact.triggerId} not starting: it was published for ${artifact.plugin?.name}@${artifact.plugin?.version}, but the code installed here is ${ref.plugin}@${ref.version} (integrity mismatch)`,
			TAG,
		);
		return;
	}
	let def: TriggerModule;
	try {
		def = await importTrigger(ref);
	} catch (error) {
		// a module that will not load fails the same way every time: counted, so it is turned off
		return void recordFailure(slot, `start failed: ${messageOf(error)}`);
	}
	try {
		return { ref, def, fingerprint: resolvedInputs(artifact, ref, def) };
	} catch (error) {
		// this environment has no value for one of its inputs (#733): the
		// trigger does not start, and says why, rather than taking the others with it
		if (!(error instanceof MissingEnvValueError)) throw error;
		logger.warn(`[triggers] ${artifact.triggerId} not starting: ${error.message}`, TAG);
	}
}

function importTrigger(ref: PluginTriggerRef) {
	let pending = modules.get(ref.entry);
	if (!pending) {
		pending = loadTrigger(ref);
		modules.set(ref.entry, pending);
		pending.catch(() => modules.delete(ref.entry));
	}
	return pending;
}

async function loadTrigger(ref: PluginTriggerRef): Promise<TriggerModule> {
	provideHostPackages();
	const mod = (await import(pathToFileURL(resolve(ref.entry)).href))?.default as
		| TriggerModule
		| undefined;
	if (typeof mod?.start !== "function")
		throw new Error(`its module's default export is not a trigger(...)`);
	if (mod.name !== ref.kind)
		throw new Error(`its module defines ${mod.name}, not the approved ${ref.kind}`);
	return mod;
}

/**
 * A crash. The first failure of an instance wins; one already stopped (by a
 * restart, a withdrawal or an earlier failure) is not this trigger's problem
 * any more. Never awaited by the caller: it may be called from inside an
 * operation the queue is still running.
 */
function onFailure(slot: Slot, instance: Instance, reason: string) {
	if (instance.stopped) return;
	instance.stopped = true;
	instance.controller.abort();
	// detached now, so a withdrawal or shutdown queued meanwhile does not close it twice
	if (slot.instance === instance) slot.instance = undefined;
	logger.warn(`[triggers] ${slot.artifact.triggerId} failed: ${reason}`, TAG);
	void enqueue(slot, async () => {
		await close(slot.artifact, instance, "failed");
		recordFailure(slot, reason, instance.startedAt);
	});
}

/**
 * Counts a failure, then restarts after a backoff, or turns the trigger off
 * after `maxFailures` in a row. An instance that ran for `stableMs` before
 * failing starts the count again.
 */
function recordFailure(slot: Slot, reason: string, startedAt?: number) {
	const { triggerId, projectId } = slot.artifact;
	// withdrawn meanwhile: nothing to restart or report
	if (slots.get(triggerId) !== slot) return;
	if (startedAt !== undefined && Date.now() - startedAt >= pluginTriggerLimits.stableMs)
		slot.failures = 0;
	slot.failures++;
	slot.lastFailure = reason;
	const { maxFailures, retryDelayMs } = pluginTriggerLimits;
	if (slot.failures >= maxFailures) {
		slots.delete(triggerId);
		const disabled = `${reason} (failed ${slot.failures} times in a row)`;
		logger.error(`[triggers] ${triggerId} turned off: ${disabled}`, TAG);
		// were the report lost, the next start fails the same way and reports again
		reportTriggerFault({ triggerId, projectId, reason: disabled });
		return;
	}
	const wait = backoffMs(retryDelayMs, slot.failures);
	logger.warn(
		`[triggers] ${triggerId} restarting in ${wait}ms (failure ${slot.failures}/${maxFailures})`,
		TAG,
	);
	slot.retry = setTimeout(() => {
		slot.retry = undefined;
		void enqueue(slot, () => start(slot));
	}, wait);
}

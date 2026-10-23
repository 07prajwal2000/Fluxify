import { AsyncLocalStorage } from "node:async_hooks";
import { pathToFileURL } from "node:url";
import { logger } from "@fluxify/common";

/**
 * An error nobody awaited — a plugin trigger's floating poll loop, a callback
 * that threw — reaches the process, not a caller. Bun exits on one by default,
 * which would take every route and workflow on the worker down with it.
 *
 * A running plugin trigger instance, as the process guard sees it. The
 * runtime registers each one while it runs.
 */
export type StrayOwner = {
	/** the trigger module's file, which an error thrown in its code names in its stack */
	entry: string;
	/** false once it stopped: a late error is its own, not the next instance's */
	live(): boolean;
	/** treats the error as this instance crashing */
	fail(error: unknown): void;
};

/**
 * The instance whose code is running. Under Bun the scope reaches the author's
 * background loop and the callbacks it schedules (timers, emitters,
 * `nextTick`), so an exception thrown there names its trigger. An unhandled
 * rejection is reported outside any scope, so it is traced by its stack.
 */
export const triggerScope = new AsyncLocalStorage<StrayOwner>();

const owners = new Set<StrayOwner>();

/** registers a running instance; the returned function forgets it */
export function trackOwner(owner: StrayOwner) {
	owners.add(owner);
	return () => void owners.delete(owner);
}

/**
 * Which instance an error came from, when that is certain: the scope it was
 * thrown in, or else the one trigger module its stack names. Several running
 * instances of one kind share a module, so their stacks cannot tell them apart.
 */
export function strayErrorOwner(error: unknown): StrayOwner | undefined {
	const scoped = triggerScope.getStore();
	if (scoped?.live()) return scoped;
	const stack = error instanceof Error ? error.stack : undefined;
	if (!stack) return;
	const named = [...owners].filter(
		(owner) =>
			owner.live() &&
			(stack.includes(owner.entry) || stack.includes(pathToFileURL(owner.entry).href)),
	);
	return named.length === 1 ? named[0] : undefined;
}

let guarded = false;

/**
 * Keeps the execution process up through errors nobody awaited. One a plugin
 * trigger caused stops and restarts that trigger, like a crash; any other is
 * logged. A block's thrown error is awaited by its run, so it never gets here
 * and still fails that run.
 */
export function guardProcess() {
	if (guarded) return;
	guarded = true;
	const handle = (what: string) => (error: unknown) => {
		const owner = strayErrorOwner(error);
		if (owner) return owner.fail(error);
		const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
		logger.error(`[execution] ${what}, kept running: ${detail}`, "WORKER.execution");
	};
	process.on("unhandledRejection", handle("unhandled rejection"));
	process.on("uncaughtException", handle("uncaught exception"));
}

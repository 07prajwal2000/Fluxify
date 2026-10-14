import { logger, type SubsystemState } from "@fluxify/common";

/** A startup error waiting will not fix (e.g. a too-old server). Not retried. */
export class FatalStartupError extends Error {}

/**
 * Startup only. Kubernetes has no `depends_on`, so admin and the orchestrator
 * routinely boot before Postgres and NATS accept connections. Retrying for a
 * bounded time turns that race into a few log lines instead of a crash-restart
 * with a growing back-off; a dependency still missing after the window is a
 * real outage and exits as before (#463).
 *
 * Not a reconnect policy: once the process is up, losing NATS must still fail
 * loudly, so nothing after boot goes through here.
 *
 * `onState` feeds the unified startup report (#797): `pending` on every retry,
 * `connected` on success, `failed` when the window runs out — so the boot log
 * carries one row per subsystem instead of a per-retry line.
 */
export async function waitFor<T>(
	name: string,
	connect: () => Promise<T>,
	attempts = 30,
	delayMs = 2_000,
	onState?: (state: SubsystemState, detail?: string) => void,
): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			const result = await connect();
			onState?.("connected");
			return result;
		} catch (error) {
			if (error instanceof FatalStartupError) {
				logger.error(`FATAL: ${error.message}`, "STARTUP");
				onState?.("failed", error.message);
				throw error;
			}
			// Drizzle wraps the driver's error, and the useful part is on its cause.
			const cause = (error as Error)?.cause;
			const reason = cause ? `${String(error)} (${String(cause)})` : String(error);
			if (attempt >= attempts) {
				const message = `FATAL: ${name} is not reachable after ${attempts} attempts: ${reason}`;
				logger.error(message, "STARTUP");
				onState?.("failed", reason);
				throw new Error(message);
			}
			logger.debug(`waiting for ${name} (${attempt}/${attempts}): ${reason}`, "STARTUP");
			onState?.("pending", `attempt ${attempt}/${attempts}`);
			await Bun.sleep(delayMs);
		}
	}
}

import { logger } from "@fluxify/common";

/**
 * Startup only. Kubernetes has no `depends_on`, so admin and the orchestrator
 * routinely boot before Postgres and NATS accept connections. Retrying for a
 * bounded time turns that race into a few log lines instead of a crash-restart
 * with a growing back-off; a dependency still missing after the window is a
 * real outage and exits as before (#463).
 *
 * Not a reconnect policy: once the process is up, losing NATS must still fail
 * loudly, so nothing after boot goes through here.
 */
export async function waitFor<T>(
	name: string,
	connect: () => Promise<T>,
	attempts = 30,
	delayMs = 2_000,
): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await connect();
		} catch (error) {
			// Drizzle wraps the driver's error, and the useful part is on its cause.
			const cause = (error as Error)?.cause;
			const reason = cause ? `${String(error)} (${String(cause)})` : String(error);
			if (attempt >= attempts) {
				const message = `FATAL: ${name} is not reachable after ${attempts} attempts: ${reason}`;
				logger.error(message, "STARTUP");
				throw new Error(message);
			}
			logger.info(`waiting for ${name} (${attempt}/${attempts}): ${reason}`, "STARTUP");
			await Bun.sleep(delayMs);
		}
	}
}

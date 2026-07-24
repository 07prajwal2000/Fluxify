import { serve } from "bun";
import { app } from "../src/server";
import { logger } from "@fluxify/common";
import { closePubSub } from "../src/db/pubsub";

import { getEnv } from "../src/lib/env";

const port = Number(getEnv("SERVER_PORT")) || 5500;

const server = serve({
	fetch: app.fetch,
	port,
});

logger.info(
	`standalone server is running at http://${server.hostname}:${server.port}`,
);

// Graceful shutdown. As PID 1 the process must install its OWN signal handlers —
// the kernel drops default-disposition signals for PID 1, so without these
// SIGTERM/SIGINT are ignored and `docker stop` hangs until SIGKILL. Stop the
// server, drain NATS, then hard-exit (open sockets would otherwise keep us up).
let shuttingDown = false;
async function shutdown(sig: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info(`received ${sig} — shutting down`);
	try {
		server.stop(true);
		await closePubSub();
	} catch (e) {
		logger.error(`shutdown error: ${e?.toString()}`);
	} finally {
		process.exit(0);
	}
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

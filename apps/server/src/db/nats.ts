import { closeNats, connectNats, natsConnected, natsConnection } from "@fluxify/common/nats";
import { NATS_TOKEN, NATS_URL } from "../lib/env";

/**
 * The process's NATS connection. Everything transport-shaped lives in
 * `@fluxify/common/nats`; this file only supplies the connection settings,
 * which are the one part that cannot live in a shared package.
 */
export async function initializeNats() {
	return connectNats({
		servers: NATS_URL,
		token: NATS_TOKEN,
		name: "fluxify.worker",
	});
}

export { closeNats, natsConnected, natsConnection };

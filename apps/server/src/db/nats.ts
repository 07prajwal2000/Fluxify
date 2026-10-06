import { closeNats, connectNats, natsConnected, natsConnection } from "@fluxify/common/nats";
import { NATS_TOKEN, NATS_URL } from "../lib/env";
import { FatalStartupError } from "../lib/waitFor";

/**
 * Schedules need 2.14+ for cron, `@every`, aliases and timezones. Older
 * servers reject the schedules stream, and the error that surfaces later
 * (`JetStreamNotEnabled`) points nowhere near the real cause.
 */
export const MIN_NATS_VERSION = "2.14.0";

export function assertNatsVersion(version: string | undefined) {
	if (!version || !Bun.semver.satisfies(version, `>=${MIN_NATS_VERSION}`)) {
		throw new FatalStartupError(
			`NATS server ${version ?? "(unknown version)"} is too old: Fluxify needs ${MIN_NATS_VERSION} or newer`,
		);
	}
}

/**
 * The process's NATS connection. Everything transport-shaped lives in
 * `@fluxify/common/nats`; this file only supplies the connection settings,
 * which are the one part that cannot live in a shared package.
 */
export async function initializeNats() {
	const nc = await connectNats({
		servers: NATS_URL,
		token: NATS_TOKEN,
		name: "fluxify.worker",
	});
	assertNatsVersion(nc.info?.version);
	return nc;
}

export { closeNats, natsConnected, natsConnection };

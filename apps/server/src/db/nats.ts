import {
	closeNats,
	connectNats,
	natsConnected,
	natsConnection,
	type StreamSpec,
} from "@fluxify/common/nats";
import { FLUXIFY_ENV, type FluxifyEnv, NATS_TOKEN, NATS_URL } from "../lib/env";
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

/**
 * A NATS name in an environment (#732). Production keeps every name as it is;
 * development gets its own: `fluxify_dev_artifacts`, `FLUXIFY_DEV_JOBS`,
 * `fluxify.dev.jobs.<project>.<kind>`. Consumer names need no variant, they
 * live inside their stream.
 *
 * A separate namespace rather than a dev consumer group: the work-queue streams
 * refuse two consumers with overlapping filters, and a dev worker must never
 * take production work anyway.
 */
export function natsName(name: string, env: FluxifyEnv = FLUXIFY_ENV) {
	if (env === "production") return name;
	const dev = name.replace(/^(fluxify|FLUXIFY)([._])/, (_, root: string, sep: string) =>
		[root, root === "FLUXIFY" ? "DEV" : "dev", ""].join(sep),
	);
	if (dev === name) throw new Error(`${name} is not a Fluxify NATS name`);
	return dev;
}

/** A stream's spec in an environment: its name and every subject it captures. */
export function natsStreamSpec<T extends StreamSpec>(spec: T, env: FluxifyEnv = FLUXIFY_ENV): T {
	if (env === "production") return spec;
	return {
		...spec,
		name: natsName(spec.name, env),
		subjects: spec.subjects.map((subject) => natsName(subject, env)),
	};
}

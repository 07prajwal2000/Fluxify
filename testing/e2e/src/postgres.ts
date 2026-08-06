import { SQL } from "bun";
import Docker from "dockerode";
import { DbType, type Connection } from "@fluxify/adapters";
import {
	docker,
	pullImage,
	removeIfPresent,
	startContainerWithRandomPort,
} from "./docker";

/**
 * One throwaway Postgres for the entire e2e run.
 *
 * Started once, lazily, and shared by every test file — the container costs
 * seconds and the suite is expected to grow to dozens of graphs. Isolation
 * between tests comes from resetting the schema, not from restarting the
 * server. `bun test` runs this package in a single process (no `--parallel`),
 * which is what makes the module-level singleton safe.
 */
const IMAGE = "postgres:bullseye";
const CONTAINER = "fluxify-e2e-postgres";
const PASSWORD = "e2e-local-only";

export type TestDatabase = {
	connection: Connection;
	sql: SQL;
};

let starting: Promise<TestDatabase> | undefined;
let running: { container: Docker.Container; sql: SQL } | undefined;

/** The shared database, started on first use. */
export function database(): Promise<TestDatabase> {
	return (starting ??= start());
}

/** Tears the container down. Called once, from the preloaded suite teardown. */
export async function stopDatabase() {
	if (!running) return;
	const { container, sql } = running;
	running = undefined;
	starting = undefined;
	await sql.close().catch(() => {});
	await container.stop().catch(() => {});
	await removeIfPresent(CONTAINER);
}

/** Polls until the server accepts queries; the container is up long before that. */
async function waitForReady(url: string) {
	for (let attempt = 0; attempt < 90; attempt++) {
		const probe = new SQL(url, { max: 1 });
		try {
			await probe`SELECT 1`;
			return;
		} catch {
			await Bun.sleep(500);
		} finally {
			await probe.close().catch(() => {});
		}
	}
	throw new Error("postgres container did not become ready");
}

async function start(): Promise<TestDatabase> {
	await removeIfPresent(CONTAINER);
	await pullImage(IMAGE);

	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: CONTAINER,
			Env: [
				"POSTGRES_USER=postgres",
				`POSTGRES_PASSWORD=${PASSWORD}`,
				"POSTGRES_DB=fluxify_e2e",
			],
			HostConfig: {
				PortBindings: { "5432/tcp": [{ HostPort: String(port) }] },
				// disposable by construction, so a killed run leaves nothing behind
				AutoRemove: true,
			},
		}),
	);
	const { container, port } = started;

	const url = `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/fluxify_e2e`;
	await waitForReady(url);

	const sql = new SQL(url);
	running = { container, sql };
	return {
		sql,
		connection: {
			dbType: DbType.POSTGRES,
			host: "127.0.0.1",
			port,
			username: "postgres",
			password: PASSWORD,
			database: "fluxify_e2e",
			ssl: false,
		},
	};
}

import Docker from "dockerode";
import { createPool, type Pool } from "mysql2/promise";
import { DbType, type Connection } from "@fluxify/adapters";
import {
	docker,
	pullImage,
	removeIfPresent,
	startContainerWithRandomPort,
} from "./docker";

/** One throwaway MySQL for the run, started lazily — same terms as `postgres.ts`. */
const IMAGE = "mysql:8.0.36-bullseye";
const CONTAINER = "fluxify-e2e-mysql";
const PASSWORD = "e2e-local-only";

export type TestMysql = {
	connection: Connection;
	pool: Pool;
};

let starting: Promise<TestMysql> | undefined;
let running: { container: Docker.Container; pool: Pool } | undefined;

export function mysql(): Promise<TestMysql> {
	return (starting ??= start());
}

export async function stopMysql() {
	if (!running) return;
	const { container, pool } = running;
	running = undefined;
	starting = undefined;
	await pool.end().catch(() => {});
	await container.stop().catch(() => {});
	await removeIfPresent(CONTAINER);
}

/** MySQL takes far longer than Postgres to accept queries after the port opens. */
async function waitForReady(uri: string) {
	for (let attempt = 0; attempt < 120; attempt++) {
		const probe = createPool({ uri, connectionLimit: 1 });
		try {
			await probe.query("SELECT 1");
			return;
		} catch {
			await Bun.sleep(500);
		} finally {
			await probe.end().catch(() => {});
		}
	}
	throw new Error("mysql container did not become ready");
}

async function start(): Promise<TestMysql> {
	await removeIfPresent(CONTAINER);
	await pullImage(IMAGE);

	const { container, port } = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: CONTAINER,
			Env: [`MYSQL_ROOT_PASSWORD=${PASSWORD}`, "MYSQL_DATABASE=fluxify_e2e"],
			HostConfig: {
				PortBindings: { "3306/tcp": [{ HostPort: String(port) }] },
				AutoRemove: true,
			},
		}),
	);

	const uri = `mysql://root:${PASSWORD}@127.0.0.1:${port}/fluxify_e2e`;
	await waitForReady(uri);

	const pool = createPool({ uri, multipleStatements: true });
	running = { container, pool };
	return {
		pool,
		connection: {
			dbType: DbType.MYSQL,
			host: "127.0.0.1",
			port,
			username: "root",
			password: PASSWORD,
			database: "fluxify_e2e",
			ssl: false,
		},
	};
}

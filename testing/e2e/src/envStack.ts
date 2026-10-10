// One admin, one NATS, and a production and a development compiled worker, run
// as their own process by `envs.ts` (#733). It is a process of its own for the
// reason `mcpStack.ts` is: the server caches its env on first import.
//
// Two data Postgres sit behind the workers, one per environment, and each holds
// a `whoami` table that names it. The development one keeps its table in a
// database `devdata`, not in `postgres`, so a development integration that
// expanded `cfg:DB_NAME` against production's value would find no table at all.
//
// Prints one `ENV_STACK <json>` line once both workers serve, and shuts down
// when its stdin closes.
import { join } from "node:path";
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import {
	createProject,
	createUser,
	req,
	signIn,
	startAuthServer,
	stopAuthServer,
} from "@fluxify/ai-gateway/src/mcp/tests/authHarness";
import { SQL } from "bun";

const IMAGE = "postgres:bullseye";
const containers: string[] = [];

function freePort() {
	const probe = Bun.serve({ port: 0, fetch: () => new Response() });
	const { port } = probe;
	probe.stop(true);
	return port;
}

async function dataPostgres(name: string, password: string) {
	await docker.getContainer(name).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const { port } = await startContainerWithRandomPort((hostPort) =>
		docker.createContainer({
			Image: IMAGE,
			name,
			Env: [`POSTGRES_PASSWORD=${password}`],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(hostPort) }] } },
		}),
	);
	containers.push(name);
	const url = (database: string) =>
		`postgres://postgres:${password}@127.0.0.1:${port}/${database}`;
	for (let attempt = 0; ; attempt++) {
		const probe = new SQL(url("postgres"), { max: 1 });
		try {
			await probe`SELECT 1`;
			await probe.close();
			break;
		} catch (error) {
			await probe.close().catch(() => {});
			if (attempt >= 90) throw error;
			await Bun.sleep(500);
		}
	}
	return { port, url };
}

async function seed(url: (database: string) => string, database: string, who: string) {
	const sql = new SQL(url(database), { max: 1 });
	await sql`CREATE TABLE whoami (env text NOT NULL)`;
	await sql`INSERT INTO whoami (env) VALUES (${who})`;
	await sql.close();
}

const prodData = await dataPostgres("fluxify-env-data-prod", "prod-secret");
await seed(prodData.url, "postgres", "production");
const devData = await dataPostgres("fluxify-env-data-dev", "dev-secret");
{
	const admin = new SQL(devData.url("postgres"), { max: 1 });
	await admin`CREATE DATABASE devdata`;
	await admin.close();
}
await seed(devData.url, "devdata", "development");

const s = await startAuthServer();
// what a real admin also runs (#735): it writes the runs workers publish, and
// knows the custom blocks a canvas save may name
const { startRecordingConsumer } = await import(
	"@fluxify/server/src/modules/recordings/consumer"
);
await startRecordingConsumer();
const { initializeCustomBlocksSubscription, loadCustomBlocks } = await import(
	"@fluxify/server/src/loaders/customBlocksLoader"
);
await loadCustomBlocks();
initializeCustomBlocksSubscription();
const projectId = await createProject(s);
const creator = await createUser(s, "creator", projectId);
const viewer = await createUser(s, "viewer", projectId);

async function apiKey(email: string) {
	const cookie = await signIn(s, email);
	const res = await req(s, "/_/admin/api/auth/api-key/create", { cookie, json: { name: "e2e" } });
	if (!res.ok) throw new Error(`api key: ${res.status} ${await res.text()}`);
	return ((await res.json()) as { key: string }).key;
}

const children: Array<ReturnType<typeof Bun.spawn>> = [];

async function worker(env: "production" | "development") {
	const port = freePort();
	const healthPort = freePort();
	const child = Bun.spawn(
		["bun", join(import.meta.dir, "../../../apps/server/deployments/compiledWorker.ts")],
		{
			env: {
				...process.env,
				FLUXIFY_ENV: env,
				WORKER_PROJECT_ID: "*",
				WORKER_MODE: "both",
				WORKER_PORT: String(port),
				WORKER_HEALTH_PORT: String(healthPort),
			},
			stdout: process.env.ENV_STACK_DEBUG ? "inherit" : "ignore",
			stderr: "inherit",
		},
	);
	children.push(child);
	const deadline = Date.now() + 90_000;
	while (
		!(await fetch(`http://127.0.0.1:${healthPort}/_/admin/api/healthchecks/ready`)
			.then((r) => r.ok)
			.catch(() => false))
	) {
		if (Date.now() > deadline || child.exitCode !== null) {
			throw new Error(`${env} worker never became ready`);
		}
		await Bun.sleep(250);
	}
	return `http://127.0.0.1:${port}`;
}

const production = await worker("production");
const development = await worker("development");

// the admin API, reachable from the test process
const server = Bun.serve({ port: 0, fetch: (request) => s.app.fetch(request) });

console.log(
	`ENV_STACK ${JSON.stringify({
		url: `http://127.0.0.1:${server.port}`,
		workers: { production, development },
		projectId,
		creatorId: creator.id,
		data: {
			production: { port: prodData.port, password: "prod-secret", database: "postgres" },
			development: { port: devData.port, password: "dev-secret", database: "devdata" },
		},
		tokens: { creator: await apiKey(creator.email), viewer: await apiKey(viewer.email) },
		// a browser login, as the portal holds it
		portalCookie: await signIn(s, creator.email),
	})}`,
);

// stdin closes when the parent test finishes, or dies
for await (const _ of Bun.stdin.stream()) {
}
for (const child of children) child.kill();
await Promise.all(children.map((child) => child.exited));
server.stop(true);
await stopAuthServer();
await Promise.all(containers.map((name) => docker.getContainer(name).remove({ force: true }).catch(() => {})));
process.exit(0);

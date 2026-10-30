// One admin, one NATS, a production compiled worker and one development compiled
// worker (two with `E2E_DEV_POOLS=2`), run as their own process by `envs.ts`
// (#733). The admin reaches the development workers only through a host-router
// that stands in for the deployment's proxy (PROXY_URL, #742). It is a process
// of its own for the reason `mcpStack.ts` is: the server caches its env on first
// import.
//
// Two data Postgres sit behind the workers, one per environment, and each holds
// a `whoami` table that names it. The development one keeps its table in a
// database `devdata`, not in `postgres`, so a development integration that
// expanded `cfg:DB_NAME` against production's value would find no table at all.
//
// Prints one `ENV_STACK <json>` line once both workers serve, and shuts down
// when its stdin closes.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

// A tiny host-router stands in for the deployment's proxy (#742). The admin
// reaches development workers only through it (PROXY_URL) and names the project
// with the Host header, so the router picks the pool by host. `E2E_DEV_POOLS=2`
// starts a second development worker and gives two subdomain projects a pool
// each, so a test can prove the router — and the admin — choose the right one.
// Every answer carries `x-e2e-pool` (a or b) so a caller sees which pool served.
const POOL_SUBDOMAINS = { a: "poola", b: "poolb" } as const;
const pools: { a?: string; b?: string } = {};
const twoPools = process.env.E2E_DEV_POOLS === "2";
const router = Bun.serve({
	port: 0,
	async fetch(request) {
		const host = (request.headers.get("host") ?? "").toLowerCase();
		const pool = twoPools && host.startsWith(`${POOL_SUBDOMAINS.b}.`) ? "b" : "a";
		const target = pools[pool] ?? pools.a;
		if (!target) return new Response("no development pool is up", { status: 503 });
		const { pathname, search } = new URL(request.url);
		try {
			const answer = await fetch(new URL(`${pathname}${search}`, target), {
				method: request.method,
				headers: request.headers,
				body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
				redirect: "manual",
			});
			const headers = new Headers(answer.headers);
			headers.set("x-e2e-pool", pool);
			return new Response(answer.body, { status: answer.status, headers });
		} catch (error) {
			return new Response(`could not reach the ${pool} pool: ${String(error)}`, { status: 502 });
		}
	},
});
// read the proxy once, before the server loads: it reads PROXY_URL for every
// development call (#735, #742)
const s = await startAuthServer({ PROXY_URL: `http://127.0.0.1:${router.port}` });
// what a real admin also runs (#735): it writes the runs workers publish
const { startRecordingConsumer } = await import(
	"@fluxify/server/src/modules/recordings/consumer"
);
await startRecordingConsumer();
const projectId = await createProject(s);
const creator = await createUser(s, "creator", projectId);
const viewer = await createUser(s, "viewer", projectId);
// another creator in the same project, who must never see the first one's sandboxes
const other = await createUser(s, "creator", projectId);
// a second project the creator also works in (#752: copy_blocks never crosses projects)
const otherProjectId = await createProject(s);
await s.db
	.insert(s.server.accessControlEntity)
	.values({ userId: creator.id, projectId: otherProjectId, role: "creator" });

// two subdomain projects, one development pool each (#742), only when asked
const poolProjects = twoPools
	? { a: await createProject(s), b: await createProject(s) }
	: undefined;
if (poolProjects) {
	const cookie = await signIn(s, creator.email);
	await s.db.insert(s.server.accessControlEntity).values(
		(["a", "b"] as const).map((pool) => ({
			userId: creator.id,
			projectId: poolProjects[pool],
			role: "creator" as const,
		})),
	);
	for (const pool of ["a", "b"] as const) {
		const res = await req(s, `/_/admin/api/v1/projects/${poolProjects[pool]}/settings/keys`, {
			method: "PUT",
			cookie,
			json: { key: "settings.routing.subdomain", value: POOL_SUBDOMAINS[pool] },
		});
		if (!res.ok) throw new Error(`pool ${pool} subdomain: ${res.status} ${await res.text()}`);
	}
}

async function apiKey(email: string) {
	const cookie = await signIn(s, email);
	const res = await req(s, "/_/admin/api/auth/api-key/create", { cookie, json: { name: "e2e" } });
	if (!res.ok) throw new Error(`api key: ${res.status} ${await res.text()}`);
	return ((await res.json()) as { key: string }).key;
}

const children: Array<ReturnType<typeof Bun.spawn>> = [];
// where workers install plugins: the default, /deps, is not writable on a CI runner
const depsDir = mkdtempSync(join(tmpdir(), "fx-e2e-deps-"));

async function worker(
	env: "production" | "development",
	port = freePort(),
	mode: "both" | "route" | "workflow" = "both",
) {
	const healthPort = freePort();
	const child = Bun.spawn(
		["bun", join(import.meta.dir, "../../../apps/server/deployments/compiledWorker.ts")],
		{
			env: {
				...process.env,
				FLUXIFY_ENV: env,
				FLUXIFY_DEPS_DIR: depsDir,
				WORKER_PROJECT_ID: "*",
				WORKER_MODE: mode,
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
// `E2E_SPLIT_WORKERS=1`: development serves routes on one node and runs workflows
// on another, so whatever crosses between them has to cross for real
const split = process.env.E2E_SPLIT_WORKERS === "1";
pools.a = await worker("development", undefined, split ? "route" : "both");
if (split) await worker("development", undefined, "workflow");
// a second development worker is the other project's pool (#742); it is only
// started when asked, so the default stack keeps one dev node for devWorkerOnline
if (twoPools) pools.b = await worker("development");
const development = pools.a;

// the admin API, reachable from the test process
const server = Bun.serve({ port: 0, fetch: (request) => s.app.fetch(request) });

console.log(
	`ENV_STACK ${JSON.stringify({
		url: `http://127.0.0.1:${server.port}`,
		workers: { production, development },
		proxyUrl: `http://127.0.0.1:${router.port}`,
		pools,
		poolProjects,
		projectId,
		otherProjectId,
		creatorId: creator.id,
		data: {
			production: { port: prodData.port, password: "prod-secret", database: "postgres" },
			development: { port: devData.port, password: "dev-secret", database: "devdata" },
		},
		tokens: {
			creator: await apiKey(creator.email),
			viewer: await apiKey(viewer.email),
			other: await apiKey(other.email),
		},
		// the admin's own Redis and NATS, for a queue trigger and a look in the artifact buckets
		redisPort: Number(process.env.REDIS_PORT),
		// the admin's own Postgres, to count rows a run must not write (#741), and the
		// development worker's pid, to stop it and see what "no worker" looks like
		adminDb: process.env.PG_URL,
		devWorkerPid: children[1]!.pid,
		nats: { servers: process.env.NATS_URL, token: process.env.NATS_TOKEN },
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
router.stop(true);
rmSync(depsDir, { recursive: true, force: true });
await stopAuthServer();
await Promise.all(containers.map((name) => docker.getContainer(name).remove({ force: true }).catch(() => {})));
process.exit(0);

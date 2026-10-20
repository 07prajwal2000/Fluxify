// A real Postgres and a real NATS JetStream behind the plugin API, shared by the
// source tests. A test file calls `startStack("name")` in `beforeAll` and
// `stopStack()` in `afterAll`; the name keeps two files' containers apart.
import { mock, spyOn } from "bun:test";
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats, openObjectBucket } from "@fluxify/common/nats";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";
import { VERSION } from "./tarball";

const PG_IMAGE = "postgres:16-alpine";
const NATS_IMAGE = "nats:2.14";

let pg: Docker.Container | undefined;
let nats: Docker.Container | undefined;
let natsUrl = "";
let sql: SQL;
let app: Hono<any>;

const publisher = await import("../../../compiler/publisher");
spyOn(publisher, "requestProjectCompile").mockImplementation(async () => {});
const loader = await import("../../../../loaders/instanceSettingsLoader");
let trusted: string[] = [];
spyOn(loader, "getSetting").mockImplementation(((key: string) =>
	key === "plugins" ? { trustedDomains: trusted } : null) as never);

/** the instance's trusted domains for the next calls */
export const setTrusted = (domains: string[]) => {
	trusted = domains;
};

async function waitForPostgres(url: string) {
	for (let i = 0; ; i++) {
		const probe = new SQL(url, { max: 1 });
		try {
			await probe`SELECT 1`;
			return;
		} catch (error) {
			if (i >= 90) throw error;
			await Bun.sleep(500);
		} finally {
			await probe.close().catch(() => {});
		}
	}
}

export async function startStack(name: string) {
	const pgName = `fluxify-plugin-${name}-pg-test`;
	const natsName = `fluxify-plugin-${name}-nats-test`;
	await docker.getContainer(pgName).remove({ force: true }).catch(() => {});
	await docker.getContainer(natsName).remove({ force: true }).catch(() => {});
	await pullImage(PG_IMAGE);
	await pullImage(NATS_IMAGE);

	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: PG_IMAGE,
			name: pgName,
			Env: ["POSTGRES_PASSWORD=postgres"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(host) }] } },
			ExposedPorts: { "5432/tcp": {} },
		}),
	);
	pg = started.container;
	const url = `postgres://postgres:postgres@127.0.0.1:${started.port}/postgres`;
	await waitForPostgres(url);
	const { migrateDB } = await import("../../../../db/migration");
	await migrateDB(url);
	sql = new SQL(url);
	mock.module("../../../../db", () => ({ db: drizzle({ client: sql }) }));

	const broker = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: NATS_IMAGE,
			name: natsName,
			Cmd: ["-js"],
			HostConfig: { PortBindings: { "4222/tcp": [{ HostPort: String(host) }] } },
			ExposedPorts: { "4222/tcp": {} },
		}),
	);
	nats = broker.container;
	natsUrl = `nats://127.0.0.1:${broker.port}`;
	const natsKv = await import("../../../../db/natsKv");
	for (let i = 0; ; i++) {
		try {
			await connectNats({ servers: natsUrl });
			await natsKv.getArtifact("probe", "production");
			break;
		} catch (error) {
			await closeNats().catch(() => {});
			if (i >= 60) throw error;
			await Bun.sleep(500);
		}
	}

	const plugins = (await import("../../../../api/v1/plugins/register")).default;
	const { errorHandler } = await import("../../../../middlewares/errorHandler");
	app = new Hono<any>();
	app.onError(errorHandler);
	app.use(async (ctx, next) => {
		ctx.set("user", { id: ctx.req.header("X-User"), isSystemAdmin: false });
		ctx.set("acl", [
			{ projectId: ctx.req.header("X-Project"), role: ctx.req.header("X-Role") ?? "creator" },
		]);
		await next();
	});
	plugins.registerHandler(app);
	return { sql };
}

export async function stopStack() {
	await sql?.close().catch(() => {});
	await closeNats().catch(() => {});
	await pg?.remove({ force: true }).catch(() => {});
	await nats?.remove({ force: true }).catch(() => {});
}

export const short = () => crypto.randomUUID().slice(0, 8);
type As = { user: string; project: string; role?: string };

async function call(as: As, method: string, path: string, body?: unknown) {
	const form = body instanceof FormData;
	const res = await app.request(`http://localhost/plugins${path}`, {
		method,
		headers: {
			"X-User": as.user,
			"X-Project": as.project,
			"X-Role": as.role ?? "creator",
			...(body === undefined || form ? {} : { "content-type": "application/json" }),
		},
		body: body === undefined ? undefined : form ? body : JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** a project of its own, and the calls a creator (or another role) makes on it */
export async function setup() {
	const project = Bun.randomUUIDv7();
	await sql`INSERT INTO projects (id, name, slug) VALUES (${project}, ${project}, ${project})`;
	const as: As = { user: `u${short()}`, project };
	const q = `projectId=${project}`;
	return {
		project,
		as,
		upload: (bytes: Uint8Array, role?: string) => {
			const form = new FormData();
			form.append("file", new File([bytes as BlobPart], "p.tgz"));
			return call({ ...as, role }, "POST", `/upload?${q}`, form);
		},
		post: (path: string, body: unknown, role?: string) =>
			call({ ...as, role }, "POST", `${path}?${q}`, body),
		put: (path: string, body: unknown, role?: string) =>
			call({ ...as, role }, "PUT", `${path}?${q}`, body),
		get: (path: string, role?: string) => call({ ...as, role }, "GET", `${path}?${q}`),
		rows: () => sql`SELECT * FROM plugins WHERE project_id = ${project}`,
	};
}

/** a connection of its own, the way a worker reads the bucket */
export async function readAsWorker(key: string) {
	const nc = await connectNats({ servers: natsUrl, connectionName: "worker" });
	try {
		return await (await openObjectBucket(nc, "fluxify_plugins")).get(key);
	} finally {
		await closeNats("worker");
	}
}

export const keyOf = (project: string) => `${project}/acme/echo/${VERSION}.tgz`;
export const sameBytes = (a: Uint8Array | null, b: Uint8Array) =>
	a !== null && Buffer.from(a).equals(Buffer.from(b));

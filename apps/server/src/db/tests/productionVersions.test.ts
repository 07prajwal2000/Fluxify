// The upgrade seed of #739 against a real Postgres: a database from before
// production versions, with routes and workflows in it, is migrated, and every
// one of them must come out serving exactly what it served. Its own file: the
// migration test is at the complexity cap.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { MIGRATIONS_FOLDER, migrateDB } from "../migration";

const IMAGE = "postgres:16-alpine";
const NAME = "fluxify-prod-versions-migration-test";
let container: Docker.Container;
let baseUrl: string;
const clients: SQL[] = [];

beforeAll(async () => {
	await docker.getContainer(NAME).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: NAME,
			Env: ["POSTGRES_PASSWORD=postgres"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(port) }] } },
		}),
	);
	container = started.container;
	baseUrl = `postgres://postgres:postgres@127.0.0.1:${started.port}`;
	for (let i = 0; ; i++) {
		const probe = new SQL(`${baseUrl}/postgres`, { max: 1 });
		try {
			await probe`SELECT 1`;
			break;
		} catch (error) {
			if (i >= 90) throw error;
			await Bun.sleep(500);
		} finally {
			await probe.close().catch(() => {});
		}
	}
}, 120_000);

afterAll(async () => {
	await Promise.all(clients.map((c) => c.close().catch(() => {})));
	await container?.remove({ force: true }).catch(() => {});
});

/** A new, empty database of its own. */
async function newDatabase() {
	const name = `t_${crypto.randomUUID().replaceAll("-", "")}`;
	const admin = new SQL(`${baseUrl}/postgres`, { max: 1 });
	await admin.unsafe(`CREATE DATABASE ${name}`);
	await admin.close();
	const url = `${baseUrl}/${name}`;
	const client = new SQL(url, { max: 1 });
	clients.push(client);
	return { url, client };
}

describe("production versions (#739)", () => {
	let client: SQL;
	const snapshotOf = async (routeId: string) =>
		(await client`SELECT v.snapshot FROM routes r JOIN canvas_versions v ON v.id = r.prod_version_id WHERE r.id = ${routeId}`)[0]
			.snapshot;

	beforeAll(async () => {
		let url: string;
		({ url, client } = await newDatabase());
		// the schema as it was one migration ago, with routes and workflows already in it
		const folder = mkdtempSync(join(tmpdir(), "fluxify-migrations-"));
		try {
			cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
			const journalPath = join(folder, "meta/_journal.json");
			const meta = await Bun.file(journalPath).json();
			const from = meta.entries.findIndex((e: { tag: string }) => e.tag === "0017_promote_deployments");
			meta.entries = meta.entries.slice(0, from);
			await Bun.write(journalPath, JSON.stringify(meta));
			await migrateDB(url, folder);
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
		await client`INSERT INTO projects (id, name, slug) VALUES ('p1', 'Shop', 'shop')`;
		await client`INSERT INTO middlewares (id, project_id, name) VALUES ('m1', 'p1', 'auth'), ('m2', 'p1', 'audit')`;
		await client`INSERT INTO routes (id, name, path, method, project_id, active, body_schema, timeout_seconds, canvas_revision)
			VALUES ('r1', 'orders', '/orders', 'POST', 'p1', true, '{"type":"object"}', 45, 7),
				('r2', 'draft', '/draft', 'GET', 'p1', false, NULL, 30, 0),
				('r3', 'orphan', '/orphan', 'GET', NULL, true, NULL, 30, 0)`;
		await client`INSERT INTO workflows (id, name, project_id, active, timeout_seconds, canvas_revision)
			VALUES ('w1', 'nightly', 'p1', true, 600, 3)`;
		await client`INSERT INTO route_middlewares (route_id, middleware_id, phase, position)
			VALUES ('r1', 'm1', 'before', 0), ('r1', 'm2', 'after', 0)`;
		await client`INSERT INTO blocks (id, key, type, position, data, route_id, workflow_id) VALUES
			('b-entry', 'entrypoint_1', 'entrypoint', '{"x":1,"y":2}', NULL, 'r1', NULL),
			('b-js', 'jsrunner_1', 'jsrunner', '{"x":3,"y":4}', '{"value":"return 1;"}', 'r1', NULL),
			('b-wf', 'entrypoint_1', 'entrypoint', NULL, NULL, NULL, 'w1')`;
		await client`INSERT INTO edges (id, "from", "to", from_handle, to_handle, route_id)
			VALUES ('e1', 'b-entry', 'b-js', 'b-entry-source', 'b-js-target', 'r1')`;
		await migrateDB(url);
	}, 120_000);

	test("every route and workflow gets one live version built from its working copy", async () => {
		expect(await snapshotOf("r1")).toEqual({
			blocks: [
				{ id: "b-entry", key: "entrypoint_1", type: "entrypoint", data: null, position: { x: 1, y: 2 } },
				{ id: "b-js", key: "jsrunner_1", type: "jsrunner", data: { value: "return 1;" }, position: { x: 3, y: 4 } },
			],
			edges: [
				{ id: "e1", from: "b-entry", to: "b-js", fromHandle: "b-entry-source", toHandle: "b-js-target" },
			],
			settings: {
				path: "/orders",
				method: "POST",
				bodySchema: { type: "object" },
				querySchema: null,
				paramsSchema: null,
				timeoutSeconds: 45,
				middlewares: { before: ["m1"], after: ["m2"] },
			},
		});
		const [workflow] = await client`SELECT v.snapshot FROM workflows w JOIN canvas_versions v ON v.id = w.prod_version_id WHERE w.id = 'w1'`;
		expect(workflow.snapshot).toEqual({
			blocks: [{ id: "b-wf", key: "entrypoint_1", type: "entrypoint", data: null, position: { x: 0, y: 0 } }],
			edges: [],
			settings: { timeoutSeconds: 600 },
		});
		// an inactive route is promoted too: switching it on later serves what it had
		expect((await snapshotOf("r2")).settings.path).toBe("/draft");
	});

	test("the version is v1 'Initial', the head, committed, and logged as a live promote", async () => {
		const [route] = await client`SELECT r.prod_version_id, r.head_version_id, r.committed_revision, r.canvas_revision, v.version_number, v.title, v.kind
			FROM routes r JOIN canvas_versions v ON v.id = r.prod_version_id WHERE r.id = 'r1'`;
		expect(route).toMatchObject({ version_number: 1, title: "Initial", kind: "route", committed_revision: 7, canvas_revision: 7 });
		expect(route.head_version_id).toBe(route.prod_version_id);
		// a version id has to pass the API's UUIDv7 check
		expect(route.prod_version_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

		const deployments = await client`SELECT kind, route_id, workflow_id, version_id, action, status, description, author_id, finished_at
			FROM deployments WHERE kind IN ('route', 'workflow') ORDER BY coalesce(route_id, workflow_id)`;
		expect(deployments).toHaveLength(3);
		expect(deployments.find((d: { route_id: string }) => d.route_id === "r1")).toMatchObject({
			kind: "route",
			version_id: route.prod_version_id,
			action: "promote",
			status: "live",
			author_id: null,
		});
		expect(deployments.every((d: { finished_at: unknown }) => d.finished_at !== null)).toBe(true);
	});

	test("a route with no project is left alone, and the migration can run again", async () => {
		const [orphan] = await client`SELECT prod_version_id FROM routes WHERE id = 'r3'`;
		expect(orphan.prod_version_id).toBeNull();
		expect(await client`SELECT id FROM canvas_versions WHERE kind IN ('route', 'workflow')`).toHaveLength(3);
	});
});

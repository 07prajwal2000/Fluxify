// The upgrade seed of #740 against a real Postgres: a database from before
// custom block and middleware versions, with both in it, is migrated, and each one
// must come out running exactly what it ran: a first version built from its
// working copy, promoted, and made its head. Its own file: the other migration
// tests are at the complexity cap.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { MIGRATIONS_FOLDER, migrateDB } from "../migration";

const IMAGE = "postgres:16-alpine";
const NAME = "fluxify-block-versions-migration-test";
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

describe("custom block and middleware versions (#740)", () => {
	let client: SQL;
	const prod = async (table: "custom_blocks_list" | "middlewares", id: string) =>
		(
			await client.unsafe(
				`SELECT v.snapshot, v.version_number, v.title, v.kind, t.prod_version_id, t.head_version_id,
					t.committed_revision, t.canvas_revision
				FROM ${table} t JOIN canvas_versions v ON v.id = t.prod_version_id WHERE t.id = $1`,
				[id],
			)
		)[0];

	beforeAll(async () => {
		let url: string;
		({ url, client } = await newDatabase());
		// the schema as it was one migration ago, with blocks and middlewares already in it
		const folder = mkdtempSync(join(tmpdir(), "fluxify-migrations-"));
		try {
			cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
			const journalPath = join(folder, "meta/_journal.json");
			const meta = await Bun.file(journalPath).json();
			const from = meta.entries.findIndex((e: { tag: string }) => e.tag === "0019_custom_block_versions");
			meta.entries = meta.entries.slice(0, from);
			await Bun.write(journalPath, JSON.stringify(meta));
			await migrateDB(url, folder);
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}
		await client`INSERT INTO projects (id, name, slug) VALUES ('p1', 'Shop', 'shop')`;
		await client`INSERT INTO custom_blocks_list (id, name, label, project_id, input_params, usage, canvas_revision) VALUES
			('c1', 'user_defined.project.tax', 'Tax', 'p1', '[{"type":"text_input","name":"rate","label":"Rate"}]', 'flow', 4),
			('c2', 'user_defined.project.guard', 'Guard', 'p1', '[]', 'middleware', 0),
			('c3', 'user_defined.project.seed', 'Seed', 'p1', NULL, 'test', 1),
			('c4', 'user_defined.project.orphan', 'Orphan', NULL, NULL, 'flow', 0)`;
		await client`INSERT INTO blocks (id, key, type, position, data, custom_block_id) VALUES
			('cb-entry', 'entrypoint_1', 'entrypoint', '{"x":1,"y":2}', NULL, 'c1'),
			('cb-js', 'jsrunner_1', 'jsrunner', NULL, '{"value":"return input * 2;"}', 'c1')`;
		await client`INSERT INTO edges (id, "from", "to", from_handle, to_handle, custom_block_id)
			VALUES ('ce1', 'cb-entry', 'cb-js', 'cb-entry-source', 'cb-js-target', 'c1')`;
		await client`INSERT INTO middlewares (id, project_id, name) VALUES ('m1', 'p1', 'auth'), ('m2', 'p1', 'empty')`;
		await client`INSERT INTO middleware_blocks (middleware_id, custom_block_id, position) VALUES ('m1', 'c2', 0)`;
		await migrateDB(url);
	}, 120_000);

	test("a custom block gets one live version built from its working copy", async () => {
		const block = await prod("custom_blocks_list", "c1");
		expect(block.snapshot).toEqual({
			blocks: [
				{ id: "cb-entry", key: "entrypoint_1", type: "entrypoint", data: null, position: { x: 1, y: 2 } },
				{ id: "cb-js", key: "jsrunner_1", type: "jsrunner", data: { value: "return input * 2;" }, position: { x: 0, y: 0 } },
			],
			edges: [
				{ id: "ce1", from: "cb-entry", to: "cb-js", fromHandle: "cb-entry-source", toHandle: "cb-js-target" },
			],
			settings: { inputParams: [{ type: "text_input", name: "rate", label: "Rate" }], usage: "flow" },
		});
		expect(block).toMatchObject({ version_number: 1, title: "Initial", kind: "custom_block" });
		// the version is the head and is committed: nothing shows as uncommitted
		expect(block.head_version_id).toBe(block.prod_version_id);
		expect(block.committed_revision).toBe(4);
		expect(block.canvas_revision).toBe(4);
		// a version id has to pass the API's UUIDv7 check
		expect(block.prod_version_id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);

		// a middleware block and a test hook are promoted too: they are live, as they were
		expect((await prod("custom_blocks_list", "c2")).snapshot.settings).toEqual({
			inputParams: [],
			usage: "middleware",
		});
		expect((await prod("custom_blocks_list", "c3")).snapshot.settings).toEqual({
			inputParams: null,
			usage: "test",
		});
	});

	test("a middleware gets its chain, in run order", async () => {
		const middleware = await prod("middlewares", "m1");
		expect(middleware.snapshot).toEqual({ blocks: [], edges: [], settings: { chain: ["c2"] } });
		expect(middleware).toMatchObject({ version_number: 1, title: "Initial", kind: "middleware" });
		expect(middleware.head_version_id).toBe(middleware.prod_version_id);
		expect((await prod("middlewares", "m2")).snapshot.settings).toEqual({ chain: [] });
	});

	test("each is logged as a live promote, and nothing is credited to a user", async () => {
		const rows = await client`SELECT kind, custom_block_id, middleware_id, version_id, action, status, author_id, finished_at
			FROM deployments ORDER BY kind, coalesce(custom_block_id, middleware_id)`;
		expect(rows).toHaveLength(5);
		expect(rows.every((r: { action: string; status: string }) => r.action === "promote" && r.status === "live")).toBe(true);
		expect(rows.every((r: { author_id: unknown; finished_at: unknown }) => r.author_id === null && r.finished_at !== null)).toBe(true);
		expect(rows.map((r: { kind: string }) => r.kind).sort()).toEqual([
			"custom_block",
			"custom_block",
			"custom_block",
			"middleware",
			"middleware",
		]);
	});

	test("a custom block with no project is left alone", async () => {
		const [orphan] = await client`SELECT prod_version_id, head_version_id FROM custom_blocks_list WHERE id = 'c4'`;
		expect(orphan).toEqual({ prod_version_id: null, head_version_id: null });
		expect(await client`SELECT id FROM canvas_versions`).toHaveLength(5);
	});

	test("the check keeps a row to exactly one owner, and the one its kind names", async () => {
		const refused = async (customBlockId: string | null, middlewareId: string | null, kind: string) => {
			try {
				await client.unsafe(
					`INSERT INTO canvas_versions (id, kind, custom_block_id, middleware_id, project_id, version_number, title, snapshot)
					VALUES ($1, $2, $3, $4, 'p1', 9, 'x', '{}'::jsonb)`,
					[Bun.randomUUIDv7(), kind, customBlockId, middlewareId],
				);
				return false;
			} catch {
				return true;
			}
		};
		expect(await refused("c1", "m1", "custom_block")).toBe(true);
		expect(await refused(null, "m1", "custom_block")).toBe(true);
		expect(await refused(null, null, "middleware")).toBe(true);
		expect(await refused(null, "m1", "middleware")).toBe(false);
	});
});

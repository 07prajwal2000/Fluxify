// Versioned migrations (#603) against a real Postgres. 16 on purpose: it is the
// oldest one we ship (the kit bundles it) and the strictest about enums.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { FatalStartupError } from "../../lib/waitFor";
import { MIGRATIONS_FOLDER, migrateDB } from "../migration";

const IMAGE = "postgres:16-alpine";
const NAME = "fluxify-migrations-test";
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

/** A new, empty database of its own, so tests never share state. */
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

const journal = (c: SQL) => c`SELECT hash, created_at FROM drizzle.__drizzle_migrations`;

/** Every column, constraint, index and enum: two databases with the same fingerprint have the same schema. */
async function fingerprint(c: SQL) {
	const rows = await c`
		SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS x
			FROM information_schema.columns WHERE table_schema = 'public'
		UNION ALL SELECT conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
			FROM pg_constraint WHERE connamespace = 'public'::regnamespace
		UNION ALL SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'
		UNION ALL SELECT t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumlabel)
			FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname
		ORDER BY 1`;
	return rows.map((r: { x: string }) => r.x);
}

async function tables(c: SQL) {
	const rows = await c`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
	return rows.map((r: { table_name: string }) => r.table_name);
}

const [baseline] = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
const POST_601_TABLES = ["session", "apikey", "jwks", "oauth_client", "oauth_access_token", "oauth_refresh_token", "oauth_consent"];

let freshFingerprint: string[];

describe("migrateDB", () => {
	test("a fresh database gets every migration and one journal row", async () => {
		const { url, client } = await newDatabase();
		await migrateDB(url);

		expect(await tables(client)).toEqual(expect.arrayContaining(["user", "projects", "system_users", ...POST_601_TABLES]));
		expect(await journal(client)).toEqual([{ hash: baseline!.hash, created_at: String(baseline!.folderMillis) }]);
		freshFingerprint = await fingerprint(client);
	});

	describe("a database installed before #601", () => {
		let url: string;
		let client: SQL;
		let seeded: unknown[];

		const seededRows = async () => [
			...(await client`SELECT * FROM "user" ORDER BY id`),
			...(await client`SELECT * FROM system_users ORDER BY id`),
			...(await client`SELECT * FROM projects ORDER BY id`),
		];

		beforeAll(async () => {
			({ url, client } = await newDatabase());
			// What an old admin image applied on first boot: drizzle-kit export of the pre-#601 schema.
			await client.unsafe(await Bun.file(join(import.meta.dir, "fixtures/pre-601-schema.sql")).text());
			await client`INSERT INTO system_users (id, email, name, is_system_admin) VALUES ('u1', 'ada@example.com', 'Ada', true)`;
			await client`INSERT INTO "user" (id, name, email) VALUES ('u1', 'Ada', 'ada@example.com')`;
			await client`INSERT INTO projects (id, name, slug) VALUES ('p1', 'Shop', 'shop')`;
			seeded = await seededRows();
		});

		test("is brought up to the current schema and keeps its rows", async () => {
			expect(await tables(client)).not.toContain("session");
			await migrateDB(url);

			expect(await tables(client)).toEqual(expect.arrayContaining(POST_601_TABLES));
			expect(await seededRows()).toEqual(seeded);
			expect(await journal(client)).toEqual([{ hash: baseline!.hash, created_at: String(baseline!.folderMillis) }]);
			// Adopting builds exactly what the migrator builds on a fresh database.
			expect(await fingerprint(client)).toEqual(freshFingerprint);
		});

		test("a second run changes nothing", async () => {
			const before = await fingerprint(client);
			await migrateDB(url);
			expect(await fingerprint(client)).toEqual(before);
			expect(await journal(client)).toHaveLength(1);
			expect(await seededRows()).toEqual(seeded);
		});
	});

	test("two migrators at once: one applies, the other waits and finds nothing to do", async () => {
		const { url, client } = await newDatabase();
		await Promise.all([migrateDB(url), migrateDB(url)]);
		expect(await journal(client)).toHaveLength(1);
		expect(await fingerprint(client)).toEqual(freshFingerprint);
	});

	test("a broken migration stops startup and leaves the database as it was", async () => {
		const { url, client } = await newDatabase();
		await migrateDB(url);
		const before = await fingerprint(client);

		const folder = mkdtempSync(join(tmpdir(), "fluxify-migrations-"));
		try {
			cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
			await Bun.write(
				join(folder, "0001_broken.sql"),
				`CREATE TABLE "broken_603" ("id" integer);--> statement-breakpoint\nSELECT * FROM "no_such_table";`,
			);
			const journalPath = join(folder, "meta/_journal.json");
			const meta = await Bun.file(journalPath).json();
			meta.entries.push({ ...meta.entries[0], idx: 1, when: baseline!.folderMillis + 1, tag: "0001_broken" });
			await Bun.write(journalPath, JSON.stringify(meta));

			const failed = migrateDB(url, folder);
			await expect(failed).rejects.toBeInstanceOf(FatalStartupError);
			await expect(failed).rejects.toThrow(/no_such_table/);
		} finally {
			rmSync(folder, { recursive: true, force: true });
		}

		expect(await tables(client)).not.toContain("broken_603");
		expect(await fingerprint(client)).toEqual(before);
		expect(await journal(client)).toHaveLength(1);
	});
});

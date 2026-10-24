import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SQL } from "bun";
import { faker } from "@faker-js/faker";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { runTrigger } from "@fluxify/sdk/testing";
import type Docker from "dockerode";
import type { Pool } from "mysql2";
import orders from "./orders";

type Row = { id: number; payload: unknown };

const PG_IMAGE = "postgres:17-alpine";
const PG_CONTAINER = "fluxify-example-integrations-orders-pg";

async function until<T>(read: () => T, done: (value: T) => boolean, timeoutMs = 10_000) {
	for (let waited = 0; waited < timeoutMs; waited += 25) {
		const value = read();
		if (done(value)) return value;
		await Bun.sleep(25);
	}
	throw new Error("the condition did not become true in time");
}

/** a Bun SQL client that claims `rows` once and answers the update, without a database */
function fakePostgres(rows: Row[], updated: number[]) {
	const tx = {
		unsafe: async (query: string, params?: unknown[]) => {
			if (query.startsWith("SELECT")) return rows;
			updated.push(...((params ?? []) as number[]));
			rows.length = 0;
			return [];
		},
	};
	return { begin: (run: (tx: unknown) => Promise<unknown>) => run(tx) } as unknown as SQL;
}

/** a mysql2 pool whose one connection answers the claim and the update */
function fakeMysql(rows: Row[], updated: number[]) {
	const connection = {
		beginTransaction: async () => {},
		commit: async () => {},
		rollback: async () => {},
		release: () => {},
		query: async (query: string, params: unknown[]) => {
			if (query.startsWith("SELECT")) return [rows, []];
			updated.push(...((params?.[1] ?? []) as number[]));
			rows.length = 0;
			return [{}, []];
		},
	};
	return { promise: () => ({ getConnection: async () => connection }) } as unknown as Pool;
}

describe("orders trigger", () => {
	it("claims rows on PostgreSQL and marks them done only after the run succeeded", async () => {
		const rows: Row[] = [
			{ id: 1, payload: "first" },
			{ id: 2, payload: "second" },
		];
		const updated: number[] = [];
		const run = await runTrigger(orders, {
			params: { database: "db", table: "jobs", everySeconds: 60, batchSize: 2 },
			integrations: {
				db: { kind: "database/PostgreSQL", client: {}, raw: fakePostgres(rows, updated) },
			},
		});
		try {
			const call = await run.nextEmit();
			expect(call.events).toEqual(rows);
			// the claim is still open while the workflow runs
			expect(updated).toEqual([]);
			call.resolve();
			await until(() => updated, (ids) => ids.length === 2);
			expect(updated).toEqual([1, 2]);
		} finally {
			await run.stop();
		}
	});

	it("uses the mysql2 client when the integration is MySQL", async () => {
		const rows: Row[] = [{ id: 7, payload: "only" }];
		const updated: number[] = [];
		const run = await runTrigger(orders, {
			params: { database: "db", table: "jobs", everySeconds: 60, batchSize: 10 },
			integrations: {
				db: { kind: "database/MySQL", client: {}, raw: fakeMysql(rows, updated) },
			},
		});
		try {
			const call = await run.nextEmit();
			expect(call.events).toEqual(rows);
			call.resolve();
			await until(() => updated, (ids) => ids.length === 1);
			expect(updated).toEqual([7]);
		} finally {
			await run.stop();
		}
	});

	it("keeps the rows for the next poll when the run fails", async () => {
		const rows: Row[] = [{ id: 3, payload: "again" }];
		const updated: number[] = [];
		const run = await runTrigger(orders, {
			params: { database: "db", table: "jobs", everySeconds: 60, batchSize: 10 },
			integrations: {
				db: { kind: "database/PostgreSQL", client: {}, raw: fakePostgres(rows, updated) },
			},
		});
		try {
			const call = await run.nextEmit();
			call.reject(new Error("the workflow failed"));
			// the poll throws back into the loop, which logs and leaves the rows alone
			await until(() => run.logs, (logs) => logs.some((log) => log.level === "error"));
			expect(updated).toEqual([]);
			expect(rows).toHaveLength(1);
		} finally {
			await run.stop();
		}
	});
});

describe("orders trigger against PostgreSQL", () => {
	let container: Docker.Container | undefined;
	let sql: SQL;
	let table: string;

	beforeAll(async () => {
		await docker.getContainer(PG_CONTAINER).remove({ force: true }).catch(() => {});
		await pullImage(PG_IMAGE);
		const started = await startContainerWithRandomPort((hostPort) =>
			docker.createContainer({
				Image: PG_IMAGE,
				name: PG_CONTAINER,
				Env: ["POSTGRES_USER=postgres", "POSTGRES_PASSWORD=12345", "POSTGRES_DB=testdb"],
				HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(hostPort) }] } },
			}),
		);
		container = started.container;
		const url = `postgres://postgres:12345@127.0.0.1:${started.port}/testdb`;
		sql = new SQL(url, { max: 2 });
		for (let attempt = 0; ; attempt++) {
			try {
				await sql`SELECT 1`;
				break;
			} catch (error) {
				if (attempt >= 90) throw error;
				await Bun.sleep(500);
			}
		}
		table = `orders_${faker.string.alphanumeric(8).toLowerCase()}`;
		await sql.unsafe(
			`CREATE TABLE ${table} (id serial PRIMARY KEY, payload text, done boolean NOT NULL DEFAULT false)`,
		);
		for (const payload of ["first", "second", "third"])
			await sql.unsafe(`INSERT INTO ${table} (payload) VALUES ($1)`, [payload]);
	}, 120_000);

	afterAll(async () => {
		await sql?.close();
		if (container) await container.remove({ force: true }).catch(() => {});
	});

	it("holds FOR UPDATE SKIP LOCKED across the run and commits the batch afterwards", async () => {
		const run = await runTrigger(orders, {
			params: { database: "db", table, everySeconds: 1, batchSize: 10 },
			integrations: { db: { kind: "database/PostgreSQL", client: {}, raw: sql } },
		});
		try {
			const call = await run.nextEmit();
			expect(call.events).toHaveLength(3);
			const [before] = (await sql.unsafe(
				`SELECT count(*) AS n FROM ${table} WHERE done`,
			)) as { n: number }[];
			expect(Number(before!.n)).toBe(0);
			call.resolve();
			for (let attempt = 0; attempt < 200; attempt++) {
				const [row] = (await sql.unsafe(
					`SELECT count(*) AS n FROM ${table} WHERE done`,
				)) as { n: number }[];
				if (Number(row!.n) === 3) break;
				await Bun.sleep(25);
			}
			const [after] = (await sql.unsafe(
				`SELECT count(*) AS n FROM ${table} WHERE done`,
			)) as { n: number }[];
			expect(Number(after!.n)).toBe(3);
		} finally {
			await run.stop();
		}
	}, 30_000);
});

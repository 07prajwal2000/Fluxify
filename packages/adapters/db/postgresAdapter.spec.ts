import { SQL } from "bun";
import {
	beforeAll,
	afterAll,
	beforeEach,
	describe,
	test,
	expect,
} from "bun:test";
import { PostgresAdapter } from "./postgresAdapter";
import { Connection, DbType } from ".";
import { JsVM } from "@fluxify/lib";
import Docker from "dockerode";
import { faker } from "@faker-js/faker";

const docker = new Docker({ host: "localhost", port: 2375 });
const containerName = "fluxify-pg-adapter-test";
const exposedPort = 54320;

let container: Docker.Container | null = null;
let adapter: PostgresAdapter;
let sql: SQL;
let vm: JsVM = {} as JsVM;

beforeAll(async () => {
	try {
		const existing = docker.getContainer(containerName);
		await existing.remove({ force: true });
	} catch (e) {}

	container = await docker.createContainer({
		Image: "postgres:bullseye",
		name: containerName,
		Env: [
			"POSTGRES_USER=postgres",
			"POSTGRES_PASSWORD=12345",
			"POSTGRES_DB=testdb",
		],
		HostConfig: {
			PortBindings: { "5432/tcp": [{ HostPort: exposedPort.toString() }] },
		},
	});

	await container.start();
	const url = `postgres://postgres:12345@127.0.0.1:${exposedPort}/testdb`;

	let ready = false;
	for (let i = 0; i < 90; i++) {
		let tempSql: SQL | null = null;
		try {
			tempSql = new SQL(url, { max: 1 });
			await tempSql`SELECT 1`;
			ready = true;
			break;
		} catch (e) {
			await new Promise((r) => setTimeout(r, 500));
		} finally {
			if (tempSql) {
				try {
					await tempSql.close();
				} catch (err) {}
			}
		}
	}

	if (!ready) throw new Error("PostgreSQL container did not become ready.");

	sql = new SQL(url);
	const db = PostgresAdapter.createKysely(sql);
	adapter = new PostgresAdapter(db, sql, vm);

	await adapter.raw(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      age INT NOT NULL,
      score INT DEFAULT 0
    )
  `);
}, 120000);

afterAll(async () => {
	if (sql) await sql.close();
	if (container) {
		try {
			await container.stop();
		} catch (e) {}
		try {
			await container.remove({ force: true });
		} catch (e) {}
	}
});

describe("PostgresAdapter Integration Tests", () => {
	beforeEach(async () => {
		// In Postgres, TRUNCATE RESTART IDENTITY ensures the ID counter resets to 1,
		// though DELETE FROM works perfectly fine too!
		await adapter.raw("DELETE FROM users");
	});

	test("Connection Validation", async () => {
		const connInfo: Connection = {
			dbType: DbType.POSTGRES,
			host: "127.0.0.1",
			port: exposedPort,
			username: "postgres",
			password: "12345",
			database: "testdb",
			ssl: false,
		};
		const res = await PostgresAdapter.testConnection(connInfo);
		expect(res.success).toBe(true);

		const badRes = await PostgresAdapter.testConnection({
			...connInfo,
			password: "wrong",
		});
		expect(badRes.success).toBe(false);
	});

	test("CRUD: Single Record Lifecycle", async () => {
		const user = {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: faker.number.int({ min: 18, max: 65 }),
		};

		const inserted = (await adapter.insert("users", user)) as any;
		expect(inserted.id).toBeGreaterThan(0);

		const fetched = await adapter.getSingle("users", [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		]);
		expect(fetched).toMatchObject(user);

		const notFound = await adapter.getSingle("users", [
			{ attribute: "id", operator: "eq", value: -1, chain: "and" },
		]);
		expect(notFound).toBeNull();

		const updated = (await adapter.update("users", { age: 29 }, [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		])) as any[];
		expect(updated[0].age).toBe(29);

		const isDeleted = await adapter.delete("users", [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		]);
		expect(isDeleted).toBe(true);
	});

	test("Advanced Filtering & Operators", async () => {
		const users = Array.from({ length: 20 }).map(() => ({
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: faker.number.int({ min: 18, max: 65 }),
			score: faker.number.int({ min: 5, max: 40 }),
		}));
		await adapter.insertBulk("users", users);

		// Greater than / Less than or equal
		const filtered = (await adapter.getAll(
			"users",
			[
				{ attribute: "age", operator: "gt", value: 10, chain: "and" },
				{ attribute: "age", operator: "lte", value: 25, chain: "and" },
			],
			10,
			0,
			{ attribute: "id", direction: "asc" },
		)) as any[];

		const filteredUsers = users.filter((u) => u.age > 10 && u.age <= 25);
		expect(filtered).toHaveLength(filteredUsers.length);
		expect(filtered.map((u) => u.name)).toEqual(
			filteredUsers.map((u) => u.name),
		);

		// OR chaining
		const orFiltered = (await adapter.getAll(
			"users",
			[
				{ attribute: "age", operator: "eq", value: 5, chain: "or" },
				{ attribute: "score", operator: "gte", value: 40, chain: "or" },
			],
			10,
			0,
			{ attribute: "id", direction: "asc" },
		)) as any[];

		const orFilteredUsers = users.filter((u) => u.age === 5 || u.score >= 40);
		expect(orFiltered.map((u) => u.name).sort()).toEqual(
			orFilteredUsers.map((u) => u.name).sort(),
		);
	});

	test("Pagination & Sorting", async () => {
		const users = Array.from({ length: 20 }).map((_, i) => ({
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 40 + i,
		}));
		await adapter.insertBulk("users", users);

		const skip = 2,
			limit = 4;
		const page = (await adapter.getAll("users", [], limit, skip, {
			attribute: "age",
			direction: "desc",
		})) as any[];

		const sortedUsers = users.sort((a, b) => b.age - a.age);
		expect(page).toHaveLength(limit);
		expect(page[0].age).toBe(sortedUsers[skip].age);
		expect(page[limit - 1].age).toBe(sortedUsers[skip + limit - 1].age);
	});

	test("Bulk Edge Cases & Mass Mutations", async () => {
		const emptyInsert = await adapter.insertBulk("users", []);
		expect(emptyInsert).toEqual([]);

		await adapter.insert("users", {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 88,
		});
		await adapter.insert("users", {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 88,
		});

		const updatedRows = (await adapter.update("users", { score: 999 }, [
			{ attribute: "age", operator: "eq", value: 88, chain: "and" },
		])) as any[];
		expect(updatedRows.length).toBeGreaterThanOrEqual(2);
		expect(updatedRows[0].score).toBe(999);

		const deleteSuccess = await adapter.delete("users", [
			{ attribute: "score", operator: "eq", value: 999, chain: "and" },
		]);
		expect(deleteSuccess).toBe(true);
	});

	test("Raw Queries", async () => {
		await adapter.insert("users", {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 100,
		});

		// Postgres uses $1 for positional parameters
		const result = (await adapter.raw(
			"SELECT COUNT(*) as total FROM users WHERE age = $1",
			[100],
		)) as any;
		expect(Number(result.rows[0].total)).toBeGreaterThan(0);
	});

	test("Transaction Lifecycle & Rollbacks", async () => {
		await adapter.startTransaction();
		const tUser = (await adapter.insert("users", {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 55,
		})) as any;
		await adapter.rollbackTransaction();

		const verifyRollback = await adapter.getSingle("users", [
			{ attribute: "id", operator: "eq", value: tUser.id, chain: "and" },
		]);
		expect(verifyRollback).toBeNull();
	});
});

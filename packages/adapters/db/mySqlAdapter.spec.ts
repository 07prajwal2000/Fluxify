import {
	beforeAll,
	afterAll,
	describe,
	test,
	expect,
	beforeEach,
} from "bun:test";
import { MySqlAdapter } from "./mySqlAdapter";
import { Connection, DbType } from ".";
import { JsVM } from "@fluxify/lib";
import type Docker from "dockerode";
import { createPool, Pool } from "mysql2";
import { faker } from "@faker-js/faker";
import { docker, pullImage } from "./testHelpers";

const containerName = "fluxify-mysql-adapter-test";
const exposedPort = 33006;

let container: Docker.Container | null = null;
let adapter: MySqlAdapter;
let pool: Pool;
let vm: JsVM = {} as JsVM;

beforeAll(async () => {
	try {
		const existing = docker.getContainer(containerName);
		await existing.remove({ force: true });
	} catch (e) {}

	await pullImage("mysql:8.0.36-bullseye");

	container = await docker.createContainer({
		Image: "mysql:8.0.36-bullseye",
		name: containerName,
		Env: ["MYSQL_ROOT_PASSWORD=12345", "MYSQL_DATABASE=testdb"],
		HostConfig: {
			PortBindings: { "3306/tcp": [{ HostPort: exposedPort.toString() }] },
		},
	});

	await container.start();

	const connInfo = {
		host: "127.0.0.1",
		port: exposedPort,
		user: "root",
		password: "12345",
		database: "testdb",
		connectionLimit: 10,
	};

	let ready = false;
	for (let i = 0; i < 90; i++) {
		let tempPool: Pool | null = null;
		try {
			tempPool = createPool({ ...connInfo, connectionLimit: 1 });
			await tempPool.promise().query("SELECT 1");
			ready = true;
			await tempPool.promise().end();
			break;
		} catch (e) {
			if (tempPool) {
				try {
					await tempPool.promise().end();
				} catch (err) {}
			}
			await new Promise((r) => setTimeout(r, 500));
		}
	}

	if (!ready) throw new Error("MySQL container did not become ready in time.");

	pool = createPool(connInfo);
	const db = MySqlAdapter.createKysely(pool);
	adapter = new MySqlAdapter(db, pool, vm);

	await adapter.raw(`
		CREATE TABLE users (
			id INT AUTO_INCREMENT PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			email VARCHAR(255) NOT NULL,
			age INT NOT NULL,
			score INT DEFAULT 0
		)
	`);
}, 120000);

beforeEach(async () => {
	await adapter.raw("TRUNCATE TABLE users");
});

afterAll(async () => {
	if (pool) await pool.promise().end();
	if (container) {
		try {
			await container.stop();
		} catch (e) {}
		try {
			await container.remove({ force: true });
		} catch (e) {}
	}
});

describe("MySqlAdapter Integration Tests", () => {
	test("Connection Validation", async () => {
		const connInfo: Connection = {
			dbType: DbType.MYSQL,
			host: "127.0.0.1",
			port: exposedPort,
			username: "root",
			password: "12345",
			database: "testdb",
		};
		const res = await MySqlAdapter.testConnection(connInfo);
		expect(res.success).toBe(true);

		const badRes = await MySqlAdapter.testConnection({
			...connInfo,
			port: 9999,
		});
		expect(badRes.success).toBe(false);
	});

	test("CRUD: Single Record Lifecycle", async () => {
		const user = {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: faker.number.int({ min: 18, max: 65 }),
		};

		const inserted = await adapter.insert("users", user);
		expect(inserted.id).toBeGreaterThan(0);

		const fetched = await adapter.getSingle("users", [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		]);
		expect(fetched).toMatchObject(user);

		const notFound = await adapter.getSingle("users", [
			{ attribute: "id", operator: "eq", value: -1, chain: "and" },
		]);
		expect(notFound).toBeNull();

		await adapter.update("users", { age: 29 }, [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		]);

		const updated = (await adapter.getSingle("users", [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		])) as any;
		expect(updated.age).toBe(29);

		const isDeleted = await adapter.delete("users", [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		]);
		expect(isDeleted).toBe(true);
	});

	test("Advanced Filtering & Operators", async () => {
		const users = Array.from({ length: 20 }).map((_, i) => ({
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

		await adapter.update("users", { score: 777 }, [
			{ attribute: "age", operator: "eq", value: 88, chain: "and" },
		]);

		const verifyUpdate = (await adapter.getAll(
			"users",
			[{ attribute: "score", operator: "eq", value: 777, chain: "and" }],
			10,
			0,
			{ attribute: "id", direction: "asc" },
		)) as any[];
		expect(verifyUpdate.length).toBeGreaterThanOrEqual(2);

		const deleteSuccess = await adapter.delete("users", [
			{ attribute: "score", operator: "eq", value: 777, chain: "and" },
		]);
		expect(deleteSuccess).toBe(true);
	});

	test("Raw Queries", async () => {
		await adapter.insert("users", {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 100,
		});
		// MySQL uses ? instead of $1 for parameters
		const result = await adapter.raw(
			"SELECT COUNT(*) as total FROM users WHERE age = ?",
			[100],
		);
		expect(Number(result.rows[0].total)).toBeGreaterThan(0);
	});

	test("Transaction Lifecycle & Rollbacks", async () => {
		await adapter.startTransaction();
		const tUser = await adapter.insert("users", {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 55,
		});
		await adapter.rollbackTransaction();

		const verifyRollback = await adapter.getSingle("users", [
			{ attribute: "id", operator: "eq", value: tUser.id, chain: "and" },
		]);
		expect(verifyRollback).toBeNull();
	});
});

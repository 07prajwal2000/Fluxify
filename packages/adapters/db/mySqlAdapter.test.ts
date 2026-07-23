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
const exposedPort = Math.floor(Math.random() * (65000 - 20000 + 1)) + 20000;

let container: Docker.Container | null = null;
let db: any;
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
	db = MySqlAdapter.createKysely(pool);
}, 120000);



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
		const adapter = new MySqlAdapter(db, pool, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id INT AUTO_INCREMENT PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				email VARCHAR(255) NOT NULL,
				age INT NOT NULL,
				score INT DEFAULT 0
			)
		`);

		const user = {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: faker.number.int({ min: 18, max: 65 }),
		};

		const inserted = await adapter.insert(tableName, user);
		expect(inserted.id).toBeGreaterThan(0);

		const fetched = await adapter.getSingle(tableName, [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		]);
		expect(fetched).toMatchObject(user);

		const notFound = await adapter.getSingle(tableName, [
			{ attribute: "id", operator: "eq", value: -1, chain: "and" },
		]);
		expect(notFound).toBeNull();

		await adapter.update(tableName, { age: 29 }, [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		]);

		const updated = (await adapter.getSingle(tableName, [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		])) as any;
		expect(updated.age).toBe(29);

		const isDeleted = await adapter.delete(tableName, [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		]);
		expect(isDeleted).toBe(true);
	});

	test("Advanced Filtering & Operators", async () => {
		const adapter = new MySqlAdapter(db, pool, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id INT AUTO_INCREMENT PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				email VARCHAR(255) NOT NULL,
				age INT NOT NULL,
				score INT DEFAULT 0
			)
		`);

		const users = Array.from({ length: 20 }).map((_, i) => ({
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: faker.number.int({ min: 18, max: 65 }),
			score: faker.number.int({ min: 5, max: 40 }),
		}));
		await adapter.insertBulk(tableName, users);

		// Greater than / Less than or equal
		const filtered = (await adapter.getAll(
			tableName,
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
			tableName,
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
		const adapter = new MySqlAdapter(db, pool, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id INT AUTO_INCREMENT PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				email VARCHAR(255) NOT NULL,
				age INT NOT NULL,
				score INT DEFAULT 0
			)
		`);

		const users = Array.from({ length: 20 }).map((_, i) => ({
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 40 + i,
		}));
		await adapter.insertBulk(tableName, users);
		const skip = 2,
			limit = 4;
		const page = (await adapter.getAll(tableName, [], limit, skip, {
			attribute: "age",
			direction: "desc",
		})) as any[];
		const sortedUsers = users.sort((a, b) => b.age - a.age);
		expect(page).toHaveLength(limit);
		expect(page[0].age).toBe(sortedUsers[skip].age);
		expect(page[limit - 1].age).toBe(sortedUsers[skip + limit - 1].age);
	});

	test("Bulk Edge Cases & Mass Mutations", async () => {
		const adapter = new MySqlAdapter(db, pool, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id INT AUTO_INCREMENT PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				email VARCHAR(255) NOT NULL,
				age INT NOT NULL,
				score INT DEFAULT 0
			)
		`);

		const emptyInsert = await adapter.insertBulk(tableName, []);
		expect(emptyInsert).toEqual([]);

		await adapter.insert(tableName, {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 88,
		});
		await adapter.insert(tableName, {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 88,
		});

		await adapter.update(tableName, { score: 777 }, [
			{ attribute: "age", operator: "eq", value: 88, chain: "and" },
		]);

		const verifyUpdate = (await adapter.getAll(
			tableName,
			[{ attribute: "score", operator: "eq", value: 777, chain: "and" }],
			10,
			0,
			{ attribute: "id", direction: "asc" },
		)) as any[];
		expect(verifyUpdate.length).toBeGreaterThanOrEqual(2);

		const deleteSuccess = await adapter.delete(tableName, [
			{ attribute: "score", operator: "eq", value: 777, chain: "and" },
		]);
		expect(deleteSuccess).toBe(true);
	});

	test("Raw Queries", async () => {
		const adapter = new MySqlAdapter(db, pool, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id INT AUTO_INCREMENT PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				email VARCHAR(255) NOT NULL,
				age INT NOT NULL,
				score INT DEFAULT 0
			)
		`);

		await adapter.insert(tableName, {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 100,
		});
		// MySQL uses ? instead of $1 for parameters
		const result = await adapter.raw(
			`SELECT COUNT(*) as total FROM ${tableName} WHERE age = ?`,
			[100],
		);
		expect(Number(result.rows[0].total)).toBeGreaterThan(0);
	});

	test("Transaction Lifecycle & Rollbacks", async () => {
		const adapter = new MySqlAdapter(db, pool, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id INT AUTO_INCREMENT PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				email VARCHAR(255) NOT NULL,
				age INT NOT NULL,
				score INT DEFAULT 0
			)
		`);

		await adapter.startTransaction();
		const tUser = await adapter.insert(tableName, {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 55,
		});
		await adapter.rollbackTransaction();

		const verifyRollback = await adapter.getSingle(tableName, [
			{ attribute: "id", operator: "eq", value: tUser.id, chain: "and" },
		]);
		expect(verifyRollback).toBeNull();
	});

	test("JSON Path Filtering (dot / bracket access)", async () => {
		const adapter = new MySqlAdapter(db, pool, vm);
		const tableName = "docs_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id INT AUTO_INCREMENT PRIMARY KEY,
				attributes JSON NOT NULL
			)
		`);

		const rows = [
			{ age: 15, min: 18, tags: ["red", "blue"] },
			{ age: 20, min: 18, tags: ["green", "blue"] },
			{ age: 30, min: 40, tags: ["red", "yellow"] },
		];
		for (const r of rows) {
			await adapter.raw(`INSERT INTO ${tableName} (attributes) VALUES (?)`, [
				JSON.stringify(r),
			]);
		}

		const sortAsc = { attribute: "id" as const, direction: "asc" as const };
		const ageOf = (r: any) =>
			(typeof r.attributes === "string"
				? JSON.parse(r.attributes)
				: r.attributes
			).age;

		// Numeric compare against JSON text (MySQL coerces text<->number).
		const adults = (await adapter.getAll(
			tableName,
			[{ attribute: "attributes.age", operator: "gte", value: 18, chain: "and" }],
			100,
			0,
			sortAsc,
		)) as any[];
		expect(adults.map(ageOf)).toEqual([20, 30]);

		// A numeric-like STRING value must behave identically.
		const adultsStr = (await adapter.getAll(
			tableName,
			[
				{
					attribute: "attributes.age",
					operator: "gte",
					value: "18",
					chain: "and",
				},
			],
			100,
			0,
			sortAsc,
		)) as any[];
		expect(adultsStr.map(ageOf)).toEqual([20, 30]);

		// Array index + nested key.
		const firstRed = (await adapter.getAll(
			tableName,
			[
				{
					attribute: "attributes.tags[0]",
					operator: "eq",
					value: "red",
					chain: "and",
				},
			],
			100,
			0,
			sortAsc,
		)) as any[];
		expect(firstRed.map(ageOf)).toEqual([15, 30]);

		// RHS references another JSON path column (age >= min).
		const meetsMin = (await adapter.getAll(
			tableName,
			[
				{
					attribute: "attributes.age",
					operator: "gte",
					value: "attributes.min",
					chain: "and",
				},
			],
			100,
			0,
			sortAsc,
		)) as any[];
		expect(meetsMin.map(ageOf)).toEqual([20]);
	});

	test("Joins & Column Selection", async () => {
		const adapter = new MySqlAdapter(db, pool, vm);
		const authors = "authors_" + faker.string.alphanumeric(6).toLowerCase();
		const books = "books_" + faker.string.alphanumeric(6).toLowerCase();
		await adapter.raw(
			`CREATE TABLE ${authors} (id INT PRIMARY KEY, name VARCHAR(255) NOT NULL)`,
		);
		await adapter.raw(
			`CREATE TABLE ${books} (id INT PRIMARY KEY, author_id INT NOT NULL, title VARCHAR(255) NOT NULL, price INT NOT NULL)`,
		);
		await adapter.raw(
			`INSERT INTO ${authors} (id, name) VALUES (1, 'Alice'), (2, 'Bob')`,
		);
		await adapter.raw(
			`INSERT INTO ${books} (id, author_id, title, price) VALUES (1, 1, 'A1', 10), (2, 1, 'A2', 20), (3, 2, 'B1', 30)`,
		);

		const sortAsc = { attribute: `${books}.id`, direction: "asc" as const };

		// Inner join, qualified condition + aliased column selection.
		const byAuthor = (await adapter.getAll(
			books,
			[
				{
					attribute: `${authors}.name`,
					operator: "eq",
					value: "Alice",
					chain: "and",
				},
			],
			100,
			0,
			sortAsc,
			{
				joins: [
					{
						table: authors,
						attribute: `${books}.author_id = ${authors}.id`,
						type: "inner",
					},
				],
				columns: [`${books}.title AS title`, `${authors}.name AS author`],
			},
		)) as any[];
		expect(byAuthor).toEqual([
			{ title: "A1", author: "Alice" },
			{ title: "A2", author: "Alice" },
		]);

		// Left join with alias, qualified numeric compare, table.* + aliased col.
		const pricey = (await adapter.getAll(
			books,
			[{ attribute: `${books}.price`, operator: "gte", value: 20, chain: "and" }],
			100,
			0,
			sortAsc,
			{
				joins: [
					{
						table: authors,
						alias: "a",
						attribute: `${books}.author_id = a.id`,
						type: "left",
					},
				],
				columns: [`${books}.*`, "a.name AS author"],
			},
		)) as any[];
		expect(pricey.map((r) => r.price)).toEqual([20, 30]);
		expect(pricey.map((r) => r.author)).toEqual(["Alice", "Bob"]);
	});
});

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
import type Docker from "dockerode";
import { faker } from "@faker-js/faker";
import { docker, pullImage } from "./testHelpers";

const containerName = "fluxify-pg-adapter-test";
const exposedPort = Math.floor(Math.random() * (65000 - 20000 + 1)) + 20000;

let container: Docker.Container | null = null;
let db: any;
let sql: SQL;
let vm: JsVM = {} as JsVM;

beforeAll(async () => {
	try {
		const existing = docker.getContainer(containerName);
		await existing.remove({ force: true });
	} catch (e) {}

	await pullImage("postgres:bullseye");

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
	db = PostgresAdapter.createKysely(sql);
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
		const adapter = new PostgresAdapter(db, sql, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id SERIAL PRIMARY KEY,
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

		const inserted = (await adapter.insert(tableName, user)) as any;
		expect(inserted.id).toBeGreaterThan(0);

		const fetched = await adapter.getSingle(tableName, [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		]);
		expect(fetched).toMatchObject(user);

		const notFound = await adapter.getSingle(tableName, [
			{ attribute: "id", operator: "eq", value: -1, chain: "and" },
		]);
		expect(notFound).toBeNull();

		const updated = (await adapter.update(tableName, { age: 29 }, [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		])) as any[];
		expect(updated[0].age).toBe(29);

		const isDeleted = await adapter.delete(tableName, [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		]);
		expect(isDeleted).toBe(true);
	});

	test("Advanced Filtering & Operators", async () => {
		const adapter = new PostgresAdapter(db, sql, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id SERIAL PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				email VARCHAR(255) NOT NULL,
				age INT NOT NULL,
				score INT DEFAULT 0
			)
		`);

		const users = Array.from({ length: 20 }).map(() => ({
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
		const adapter = new PostgresAdapter(db, sql, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id SERIAL PRIMARY KEY,
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
		const adapter = new PostgresAdapter(db, sql, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id SERIAL PRIMARY KEY,
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

		const updatedRows = (await adapter.update(tableName, { score: 999 }, [
			{ attribute: "age", operator: "eq", value: 88, chain: "and" },
		])) as any[];
		expect(updatedRows.length).toBeGreaterThanOrEqual(2);
		expect(updatedRows[0].score).toBe(999);

		const deleteSuccess = await adapter.delete(tableName, [
			{ attribute: "score", operator: "eq", value: 999, chain: "and" },
		]);
		expect(deleteSuccess).toBe(true);
	});

	test("Raw Queries", async () => {
		const adapter = new PostgresAdapter(db, sql, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id SERIAL PRIMARY KEY,
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

		// Postgres uses $1 for positional parameters
		const result = (await adapter.raw(
			`SELECT COUNT(*) as total FROM ${tableName} WHERE age = $1`,
			[100],
		)) as any;
		expect(Number(result.rows[0].total)).toBeGreaterThan(0);
	});

	test("Transaction Lifecycle & Rollbacks", async () => {
		const adapter = new PostgresAdapter(db, sql, vm);
		const tableName = "users_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id SERIAL PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				email VARCHAR(255) NOT NULL,
				age INT NOT NULL,
				score INT DEFAULT 0
			)
		`);

		await adapter.startTransaction();
		const tUser = (await adapter.insert(tableName, {
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: 55,
		})) as any;
		await adapter.rollbackTransaction();

		const verifyRollback = await adapter.getSingle(tableName, [
			{ attribute: "id", operator: "eq", value: tUser.id, chain: "and" },
		]);
		expect(verifyRollback).toBeNull();
	});

	test("JSONB Path Filtering (dot / bracket access)", async () => {
		const adapter = new PostgresAdapter(db, sql, vm);
		const tableName = "docs_" + faker.string.alphanumeric(8).toLowerCase();
		await adapter.raw(`
			CREATE TABLE ${tableName} (
				id SERIAL PRIMARY KEY,
				attributes JSONB NOT NULL
			)
		`);

		const rows = [
			{ age: 15, min: 18, tags: ["red", "blue"] },
			{ age: 20, min: 18, tags: ["green", "blue"] },
			{ age: 30, min: 40, tags: ["red", "yellow"] },
		];
		for (const r of rows) {
			await adapter.insert(tableName, { attributes: r });
		}

		const sortAsc = { attribute: "id" as const, direction: "asc" as const };
		// Bun's SQL driver returns jsonb columns as strings on read.
		const attrs = (r: any) =>
			typeof r.attributes === "string"
				? JSON.parse(r.attributes)
				: r.attributes;

		// Numeric compare against JSONB text (needs the ::numeric cast).
		const adults = (await adapter.getAll(
			tableName,
			[{ attribute: "attributes.age", operator: "gte", value: 18, chain: "and" }],
			100,
			0,
			sortAsc,
		)) as any[];
		expect(adults.map((r) => attrs(r).age)).toEqual([20, 30]);

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
		expect(adultsStr.map((r) => attrs(r).age)).toEqual([20, 30]);

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
		expect(firstRed.map((r) => attrs(r).age)).toEqual([15, 30]);

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
		expect(meetsMin.map((r) => attrs(r).age)).toEqual([20]);
	});

	test("Joins & Column Selection", async () => {
		const adapter = new PostgresAdapter(db, sql, vm);
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

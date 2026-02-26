import {
	beforeAll,
	afterAll,
	beforeEach,
	describe,
	test,
	expect,
} from "bun:test";
import { MongoAdapter, buildMongoUrl } from "./mongoDbAdapter";
import { Connection, DbType } from ".";
import { JsVM } from "@fluxify/lib";
import Docker from "dockerode";
import { MongoClient } from "mongodb";
import { fakerEN as faker } from "@faker-js/faker";

const isCI = process.env.CI === "true";
const docker = isCI
	? new Docker({ socketPath: "/var/run/docker.sock" })
	: new Docker({ host: "localhost", port: 2375 });
const containerName = "fluxify-mongo-adapter-test";
const exposedPort = 27017;

let container: Docker.Container | null = null;
let adapter: MongoAdapter;
let client: MongoClient;
let vm: JsVM = {} as JsVM;

beforeAll(async () => {
	try {
		const existing = docker.getContainer(containerName);
		await existing.remove({ force: true });
	} catch (e) {}

	// We boot without root credentials specifically to allow easy Replica Set initialization locally
	container = await docker.createContainer({
		Image: "mongo:7.0",
		name: containerName,
		Cmd: ["mongod", "--replSet", "rs0", "--bind_ip_all"],
		HostConfig: {
			PortBindings: { "27017/tcp": [{ HostPort: exposedPort.toString() }] },
		},
	});

	await container.start();

	const connInfo: Connection = {
		dbType: DbType.MONGODB,
		host: "127.0.0.1",
		port: exposedPort,
		username: "",
		password: "",
		database: "testdb",
		ssl: false,
	};

	let ready = false;
	client = new MongoClient(buildMongoUrl(connInfo), {
		serverSelectionTimeoutMS: 1000,
	});

	for (let i = 0; i < 90; i++) {
		try {
			await client.connect();
			await client.db("admin").command({ ping: 1 });

			// Initiate the Replica Set (Required for MongoDB Transactions)
			try {
				await client.db("admin").command({
					replSetInitiate: {
						_id: "rs0",
						members: [{ _id: 0, host: "127.0.0.1:27017" }],
					},
				});
			} catch (initErr: any) {
				// Ignore if already initialized
				if (!initErr.message.includes("already initialized")) throw initErr;
			}

			// Wait a brief moment for the node to become PRIMARY
			await new Promise((r) => setTimeout(r, 2000));
			ready = true;
			break;
		} catch (e) {
			await new Promise((r) => setTimeout(r, 500));
		}
	}

	if (!ready) throw new Error("MongoDB container did not become ready.");

	const db = client.db("testdb");
	adapter = new MongoAdapter(client, db, vm);
}, 120000);

beforeEach(async () => {
	// Equivalent to TRUNCATE TABLE
	await adapter.delete("users", []);
});

afterAll(async () => {
	if (client) await client.close();
	if (container) {
		try {
			await container.stop();
		} catch (e) {}
		try {
			await container.remove({ force: true });
		} catch (e) {}
	}
});

describe("MongoAdapter Integration Tests", () => {
	test("Connection Validation", async () => {
		const connInfo: Connection = {
			dbType: DbType.MONGODB,
			host: "127.0.0.1",
			port: exposedPort,
			username: "",
			password: "",
			database: "testdb",
			ssl: false,
		};
		const res = await MongoAdapter.testConnection(connInfo);
		expect(res.success).toBe(true);

		const badRes = await MongoAdapter.testConnection({
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

		const inserted = (await adapter.insert("users", user)) as typeof user & {
			id: string;
		};

		expect(inserted.id).toBeDefined(); // Verifies _id mapped to id

		const fetched = await adapter.getSingle("users", [
			{ attribute: "id", operator: "eq", value: inserted.id, chain: "and" },
		]);
		expect(fetched).toMatchObject(user);

		const notFound = await adapter.getSingle("users", [
			{
				attribute: "id",
				operator: "eq",
				value: "000000000000000000000000",
				chain: "and",
			},
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
		const users = Array.from({ length: 20 }).map(() => ({
			name: faker.person.firstName(),
			email: faker.internet.email(),
			age: faker.number.int({ min: 18, max: 65 }),
			score: faker.number.int({ min: 5, max: 40 }),
		}));
		await adapter.insertBulk("users", users);

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

		await adapter.insert("users", { name: "Mass", age: 88 });
		await adapter.insert("users", { name: "Mass", age: 88 });

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

	test("Raw Queries (Command API)", async () => {
		await adapter.insert("users", { name: "Raw", age: 100 });

		// In Mongo, raw uses DB commands. We can use the 'count' command here.
		const result = (await adapter.raw({
			count: "users",
			query: { age: 100 },
		})) as any;
		expect(result.n).toBeGreaterThan(0);
	});

	test("Transaction Lifecycle & Rollbacks", async () => {
		await adapter.startTransaction();
		const tUser = (await adapter.insert("users", {
			name: "TrxTest",
			age: 55,
		})) as any;
		await adapter.rollbackTransaction();

		const verifyRollback = await adapter.getSingle("users", [
			{ attribute: "id", operator: "eq", value: tUser.id, chain: "and" },
		]);
		expect(verifyRollback).toBeNull();
	});
});

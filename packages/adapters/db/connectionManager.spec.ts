import { describe, expect, it } from "bun:test";
import {
	DbConnectionManager,
	DbFactory,
	DbType,
	type Connection,
	type ManagedDbConnection,
} from ".";

const mysql: Connection = {
	dbType: DbType.MYSQL,
	host: "db.internal",
	port: 3306,
	username: "worker",
	password: "secret",
	database: "fluxify",
};

function createFakeManager() {
	const closed: string[] = [];
	let created = 0;
	const manager = new DbConnectionManager((integrationId, config) => {
		created += 1;
		return {
			type: config.dbType,
			db: {},
			pool: {} as any,
			close: async () => {
				closed.push(`${integrationId}:${config.password}`);
			},
		} satisfies ManagedDbConnection;
	});
	return {
		manager,
		closed,
		created: () => created,
	};
}

describe("DbConnectionManager", () => {
	it("shares one MySQL pool across 10,000 request-local factories", () => {
		const fake = createFakeManager();
		for (let request = 0; request < 10_000; request++) {
			const factory = new DbFactory({} as any, { mysql }, fake.manager);
			factory.getDbAdapter("mysql");
			factory.dispose();
		}

		expect(fake.created()).toBe(1);
		expect(fake.manager.getStats()).toEqual({
			active: 1,
			retiring: 0,
			leases: 0,
		});
	});

	it("atomically swaps changed credentials and drains the borrowed pool", async () => {
		const fake = createFakeManager();
		const inFlight = new DbFactory({} as any, { mysql }, fake.manager);
		inFlight.getDbAdapter("mysql");

		fake.manager.synchronize({
			mysql: { ...mysql, password: "rotated-secret" },
		});
		expect(fake.created()).toBe(2);
		expect(fake.closed).toEqual([]);

		const nextRequest = new DbFactory(
			{} as any,
			{ mysql: { ...mysql, password: "rotated-secret" } },
			fake.manager,
		);
		nextRequest.getDbAdapter("mysql");
		inFlight.dispose();
		await Promise.resolve();
		expect(fake.closed).toEqual(["mysql:secret"]);

		nextRequest.dispose();
		await fake.manager.close();
		expect(fake.closed).toEqual(["mysql:secret", "mysql:rotated-secret"]);
	});

	it("closes active PostgreSQL, MySQL, and MongoDB clients on runtime shutdown", async () => {
		const fake = createFakeManager();
		const configs = {
			pg: { ...mysql, dbType: DbType.POSTGRES },
			mysql,
			mongo: { ...mysql, dbType: DbType.MONGODB },
		};
		for (const integrationId of Object.keys(configs)) {
			const factory = new DbFactory({} as any, configs, fake.manager);
			factory.getDbAdapter(integrationId);
		}

		await fake.manager.close();
		expect(fake.closed.sort()).toEqual([
			"mongo:secret",
			"mysql:secret",
			"pg:secret",
		]);
	});
});

import { describe, expect, it } from "bun:test";
import {
	DbConnectionManager,
	DbFactory,
	DbType,
	type Connection,
	type ManagedDbConnection,
	type DbConnectionTimer,
} from ".";

const mysql: Connection = {
	dbType: DbType.MYSQL,
	host: "db.internal",
	port: 3306,
	username: "worker",
	password: "secret",
	database: "fluxify",
};

class FakeTimers implements DbConnectionTimer {
	private currentTime = 0;
	private nextId = 1;
	private readonly tasks = new Map<number, { at: number; handler: () => void }>();

	setTimeout(handler: () => void, timeoutMs: number) {
		const id = this.nextId++;
		this.tasks.set(id, { at: this.currentTime + timeoutMs, handler });
		return id;
	}

	clearTimeout(handle: unknown) {
		this.tasks.delete(handle as number);
	}

	advanceBy(timeoutMs: number) {
		this.currentTime += timeoutMs;
		for (const [id, task] of [...this.tasks]) {
			if (task.at > this.currentTime) continue;
			this.tasks.delete(id);
			task.handler();
		}
	}
}

function createFakeManager(options = {}) {
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
	}, options);
	return {
		manager,
		closed,
		created: () => created,
	};
}

describe("DbConnectionManager", () => {
	it("closes an unused pool after 7.5 minutes using fast-forwarded fake timers", async () => {
		const timers = new FakeTimers();
		const fake = createFakeManager({
			idleTimeoutMs: 450_000,
			timer: timers,
		});
		const factory = new DbFactory({} as any, { mysql }, fake.manager);
		factory.getDbAdapter("mysql");
		factory.dispose();

		timers.advanceBy(449_999);
		await Promise.resolve();
		expect(fake.closed).toEqual([]);

		timers.advanceBy(1);
		await Promise.resolve();
		await Promise.resolve();
		expect(fake.closed).toEqual(["mysql:secret"]);
		expect(fake.manager.getStats()).toEqual({
			active: 0,
			retiring: 0,
			leases: 0,
		});
	});

	it("resets the idle timer when a pool is borrowed again", async () => {
		const timers = new FakeTimers();
		const fake = createFakeManager({ idleTimeoutMs: 450_000, timer: timers });
		const firstRequest = new DbFactory({} as any, { mysql }, fake.manager);
		firstRequest.getDbAdapter("mysql");
		firstRequest.dispose();

		timers.advanceBy(449_999);
		const secondRequest = new DbFactory({} as any, { mysql }, fake.manager);
		secondRequest.getDbAdapter("mysql");
		timers.advanceBy(1);
		await Promise.resolve();
		expect(fake.closed).toEqual([]);

		secondRequest.dispose();
		timers.advanceBy(450_000);
		await Promise.resolve();
		await Promise.resolve();
		expect(fake.closed).toEqual(["mysql:secret"]);
	});

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

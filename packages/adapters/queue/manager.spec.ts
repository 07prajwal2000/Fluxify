import { describe, expect, it } from "bun:test";
import {
	QueueConnection,
	QueueConnectionManager,
	type QueueConnector,
	type QueueHandler,
	type QueueSubscription,
	type QueueTriggerSpec,
} from "..";

const subscription: QueueSubscription = {
	topics: ["orders"],
	consumerGroup: "fluxify-t1",
	batchSize: 10,
	maxWaitMs: 500,
	maxBytes: 1024 * 1024,
	concurrency: 1,
};

const spec = (password = "secret"): QueueTriggerSpec => ({
	type: "fake",
	config: { brokers: ["broker:9092"], password },
	subscription,
});

const noop: QueueHandler = async () => {};

class FakeConnection extends QueueConnection {
	constructor(
		private readonly log: string[],
		readonly password: string,
		private readonly failConsume = false,
	) {
		super();
	}
	async consume() {
		if (this.failConsume) throw new Error("bad credentials");
		this.log.push(`consume:${this.password}`);
	}
	async commit() {}
	async moveToDLQ() {}
	async lag() {
		return 0;
	}
	async stop() {
		await Promise.resolve();
		this.log.push(`stop:${this.password}`);
	}
	raw() {
		return this;
	}
}

function createFake() {
	const log: string[] = [];
	let loads = 0;
	const connector: QueueConnector = {
		createConnection: (config) => {
			const { password } = config as { password: string };
			return new FakeConnection(log, password, password === "wrong");
		},
	};
	const manager = new QueueConnectionManager(async (type) => {
		if (type !== "fake") throw new Error(`No queue connector registered for "${type}"`);
		loads += 1;
		return connector;
	});
	return { manager, log, loads: () => loads };
}

describe("QueueConnectionManager", () => {
	it("loads a connector on the first trigger of its type and shares it", async () => {
		const fake = createFake();
		expect(fake.loads()).toBe(0);

		await fake.manager.start("t1", spec(), noop);
		await fake.manager.start("t2", spec(), noop);

		expect(fake.loads()).toBe(1);
		expect(fake.manager.getStats()).toEqual({ running: 2, connectors: ["fake"] });
	});

	it("drops the connector with its last trigger and reloads it on the next", async () => {
		const fake = createFake();
		await fake.manager.start("t1", spec(), noop);
		await fake.manager.start("t2", spec(), noop);

		await fake.manager.stop("t1");
		expect(fake.manager.getStats().connectors).toEqual(["fake"]);
		await fake.manager.stop("t2");
		expect(fake.manager.getStats()).toEqual({ running: 0, connectors: [] });

		await fake.manager.start("t3", spec(), noop);
		expect(fake.loads()).toBe(2);
	});

	it("leaves an unchanged trigger alone", async () => {
		const fake = createFake();
		await fake.manager.start("t1", spec(), noop);
		await fake.manager.start("t1", spec(), noop);
		expect(fake.log).toEqual(["consume:secret"]);
	});

	it("drains the old consumer before starting one with rotated credentials", async () => {
		const fake = createFake();
		await fake.manager.start("t1", spec(), noop);
		await fake.manager.start("t1", spec("rotated"), noop);

		expect(fake.log).toEqual(["consume:secret", "stop:secret", "consume:rotated"]);
		expect((fake.manager.connection("t1") as FakeConnection).password).toBe("rotated");
	});

	it("keeps a start racing a stop in order, leaving nothing running", async () => {
		const fake = createFake();
		const started = fake.manager.start("t1", spec(), noop);
		const stopped = fake.manager.stop("t1");
		await Promise.all([started, stopped]);

		expect(fake.log).toEqual(["consume:secret", "stop:secret"]);
		expect(fake.manager.has("t1")).toBe(false);
	});

	it("cleans up a consumer that fails to start", async () => {
		const fake = createFake();
		await expect(fake.manager.start("t1", spec("wrong"), noop)).rejects.toThrow(
			"bad credentials",
		);

		expect(fake.log).toEqual(["stop:wrong"]);
		expect(fake.manager.getStats()).toEqual({ running: 0, connectors: [] });
	});

	it("rejects a type with no connector without holding it loaded", async () => {
		const fake = createFake();
		await expect(
			fake.manager.start("t1", { ...spec(), type: "missing" }, noop),
		).rejects.toThrow('No queue connector registered for "missing"');
		expect(fake.manager.getStats()).toEqual({ running: 0, connectors: [] });
	});

	it("stops every consumer on close", async () => {
		const fake = createFake();
		await fake.manager.start("t1", spec(), noop);
		await fake.manager.start("t2", spec("other"), noop);

		await fake.manager.close();
		expect(fake.log.filter((line) => line.startsWith("stop")).sort()).toEqual([
			"stop:other",
			"stop:secret",
		]);
		expect(fake.manager.getStats()).toEqual({ running: 0, connectors: [] });
	});
});

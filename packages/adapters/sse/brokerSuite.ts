import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { KvFactory } from "../kv/factory";
import type { SseBroker } from "./broker";
import { type BrokerSource, SseBrokerRegistry } from "./registry";

/** What a broker's container gives the shared tests. */
export type Harness = {
	source: () => BrokerSource;
	/** restarts the broker process; the host port stays */
	restart: () => Promise<void>;
	/** connections that currently hold a subscription, counted by the server itself */
	subscribers: () => Promise<number>;
	/** a Redis KV integration config for the same server */
	kv?: () => Record<string, unknown>;
};

export async function until(done: () => boolean | Promise<boolean>, ms = 30_000) {
	const deadline = Date.now() + ms;
	while (!(await done())) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await Bun.sleep(100);
	}
}

const unique = () => randomUUID().slice(0, 8);

/** The count once the previous test's closing connections are gone from the server. */
async function settled(harness: () => Harness) {
	await until(async () => (await harness().subscribers()) === 0, 10_000);
	return 0;
}

/** The tests every broker must pass, run against a real server. */
export function brokerSuite(harness: () => Harness) {
	const registries: SseBrokerRegistry[] = [];
	/** one process: its own registry, so its own connections */
	const node = (project = `p${unique()}`) => {
		const registry = new SseBrokerRegistry(() => harness().source());
		registries.push(registry);
		return { broker: registry.brokerFor(project, "int_1"), registry, project };
	};
	const listen = async (broker: SseBroker, subject: string) => {
		const got: string[] = [];
		const off = await broker.subscribe(subject, (message) => got.push(message));
		return { got, off };
	};
	// a message sent now and one sent after it: the second arriving proves the first was not merely late
	const quiet = (ms = 400) => Bun.sleep(ms);

	afterEach(async () => {
		await Promise.all(registries.splice(0).map((registry) => registry.closeAll()));
	});

	describe("delivery", () => {
		it("delivers to the exact subject, text intact", async () => {
			const { broker, project } = node();
			const subject = `fluxify.sse.${project}.conv_1`;
			const { got } = await listen(broker, subject);
			const text = 'line one\nline "two" ✓ {"t":"data"}';
			await broker.publish(subject, text);
			await until(() => got.length === 1);
			expect(got).toEqual([text]);
		});

		it("does not deliver to a different subject, or to a node that did not subscribe", async () => {
			const project = `p${unique()}`;
			const holder = node(project).broker;
			const other = node(project).broker;
			const sender = node(project).broker;
			const mine = await listen(holder, `fluxify.sse.${project}.a`);
			const theirs = await listen(other, `fluxify.sse.${project}.b`);
			await sender.publish(`fluxify.sse.${project}.a`, "for a");
			await until(() => mine.got.length === 1);
			await quiet();
			expect(mine.got).toEqual(["for a"]);
			expect(theirs.got).toEqual([]);
			// the other node was alive the whole time
			await sender.publish(`fluxify.sse.${project}.b`, "for b");
			await until(() => theirs.got.length === 1);
			expect(mine.got).toEqual(["for a"]);
		});

		it("does not match by prefix", async () => {
			const { broker, project } = node();
			const longer = await listen(broker, `fluxify.sse.${project}.conv.extra`);
			const exact = await listen(broker, `fluxify.sse.${project}.conv`);
			await broker.publish(`fluxify.sse.${project}.conv`, "x");
			await until(() => exact.got.length === 1);
			await quiet();
			expect(longer.got).toEqual([]);
		});

		it("gives every listener of one subject the message", async () => {
			const { broker, project } = node();
			const subject = `fluxify.sse.${project}.shared`;
			const one = await listen(broker, subject);
			const two = await listen(broker, subject);
			await broker.publish(subject, "both");
			await until(() => one.got.length === 1 && two.got.length === 1);
		});

		it("refuses a wildcard or pattern subject", async () => {
			const { broker } = node();
			for (const subject of ["fluxify.sse.p.>", "fluxify.sse.*.x", "fluxify.sse.p. x", "", "a..b"])
				expect(broker.subscribe(subject, () => {})).rejects.toThrow("not an exact subject");
			expect(broker.publish("fluxify.sse.p.>", "x")).rejects.toThrow("not an exact subject");
		});
	});

	describe("unsubscribe", () => {
		it("stops delivery, leaves the others, and is safe to call twice", async () => {
			const { broker, project } = node();
			const subject = `fluxify.sse.${project}.u`;
			const stay = await listen(broker, subject);
			const leave = await listen(broker, subject);
			await leave.off();
			await leave.off();
			await broker.publish(subject, "after");
			await until(() => stay.got.length === 1);
			await quiet();
			expect(leave.got).toEqual([]);
			await stay.off();
			await broker.publish(subject, "nobody");
			await quiet();
			expect(stay.got).toEqual(["after"]);
		});

		it("subscribes again after the last unsubscribe closed the connection", async () => {
			const { broker, project } = node();
			const subject = `fluxify.sse.${project}.again`;
			await (await listen(broker, subject)).off();
			const second = await listen(broker, subject);
			await broker.publish(subject, "back");
			await until(() => second.got.length === 1);
		});

		it("survives a listener that throws", async () => {
			const { broker, project } = node();
			const subject = `fluxify.sse.${project}.boom`;
			await broker.subscribe(subject, () => {
				throw new Error("listener bug");
			});
			const healthy = await listen(broker, subject);
			await broker.publish(subject, "one");
			await broker.publish(subject, "two");
			await until(() => healthy.got.length === 2);
		});
	});

	describe("connections", () => {
		it("holds one subscriber connection for many subscriptions, and closes it with the last", async () => {
			const before = await settled(harness);
			const { broker, project } = node();
			const listeners = [];
			for (const name of ["a", "b", "c", "d"])
				listeners.push(await listen(broker, `fluxify.sse.${project}.${name}`));
			expect(await harness().subscribers()).toBe(before + 1);
			for (const listener of listeners.slice(0, 3)) await listener.off();
			expect(await harness().subscribers()).toBe(before + 1);
			await listeners[3]?.off();
			await until(async () => (await harness().subscribers()) === before);
		});

		it("reuses the broker of one project and integration, and splits projects apart", async () => {
			const { registry, project } = node();
			expect(registry.brokerFor(project, "int_1")).toBe(registry.brokerFor(project, "int_1"));
			expect(registry.brokerFor(project, "int_1")).not.toBe(registry.brokerFor("other", "int_1"));
			expect(registry.brokerFor(project, "int_1")).not.toBe(registry.brokerFor(project, "int_2"));
		});

		it("opens nothing until the first subscribe", async () => {
			const before = await settled(harness);
			const { broker } = node();
			expect(await harness().subscribers()).toBe(before);
			expect(broker).toBeDefined();
		});

		it("keeps projects that share a broker apart by subject", async () => {
			const a = node();
			const b = node();
			const mine = await listen(a.broker, `fluxify.sse.${a.project}.id`);
			const theirs = await listen(b.broker, `fluxify.sse.${b.project}.id`);
			await a.broker.publish(`fluxify.sse.${a.project}.id`, "a only");
			await until(() => mine.got.length === 1);
			await quiet();
			expect(theirs.got).toEqual([]);
		});

		it("fails the subscribe, not the process, when the integration is gone", () => {
			const registry = new SseBrokerRegistry(() => undefined);
			expect(() => registry.brokerFor("p", "missing")).toThrow("No SSE broker integration");
		});
	});

	it("recovers after the broker restarts", async () => {
		const { broker, project } = node();
		const subject = `fluxify.sse.${project}.restart`;
		const { got } = await listen(broker, subject);
		await broker.publish(subject, "before");
		await until(() => got.length === 1);

		await harness().restart();

		// the client reconnects and resubscribes on its own; keep sending until one lands
		await until(async () => {
			await broker.publish(subject, "after").catch(() => undefined);
			await Bun.sleep(250);
			return got.includes("after");
		}, 60_000);
	}, 120_000);

	it("keeps the shared KV client working while subscriptions are open", async () => {
		const kv = harness().kv;
		if (!kv) return;
		const { broker, project } = node();
		const { got } = await listen(broker, `fluxify.sse.${project}.kv`);
		const adapter = new KvFactory({ main: kv() as never }).getKvAdapter("main");
		try {
			const key = `k_${unique()}`;
			await adapter.set(key, "value");
			expect(await adapter.get(key)).toBe("value");
			await broker.publish(`fluxify.sse.${project}.kv`, "still flowing");
			await until(() => got.length === 1);
		} finally {
			await KvFactory.ResetConnections();
		}
	});
}

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { param } from "@fluxify/sdk/blocks";
import { type AnyTrigger, trigger } from "@fluxify/sdk/triggers";
import {
	applyPluginTrigger,
	hasPluginTrigger,
	pluginTriggerLimits,
	pluginTriggerStatus,
	refreshPluginTriggers,
	shutdownPluginTriggers,
} from "../pluginTriggerRuntime";
import {
	appConfig,
	artifact,
	faults,
	fastLimits,
	install,
	resetLimits,
	uninstallAll,
	until,
} from "./pluginTriggerHarness";

const base = { label: "Poll", icon: "./poll.svg" };

/** a trigger recording each instance's life by its `id` param: start, abort, stop */
function recorder(name: string, extra: Partial<AnyTrigger> = {}) {
	const log: string[] = [];
	const def = trigger({
		...base,
		name,
		params: { id: param.string({ required: true }), token: param.secret() },
		start: async (ctx) => {
			log.push(`start ${ctx.params.id}`);
			ctx.signal.addEventListener("abort", () => log.push(`abort ${ctx.params.id}`));
			return async () => void log.push(`stop ${ctx.params.id}`);
		},
		...(extra as object),
	} as never) as AnyTrigger;
	return { def, log };
}

const running = (id: string) => until(() => hasPluginTrigger(id), Boolean, `${id} to run`);

beforeEach(() => {
	fastLimits();
	faults.length = 0;
	appConfig({});
});
afterEach(async () => {
	await shutdownPluginTriggers();
	uninstallAll();
});
afterAll(resetLimits);

describe("plugin trigger instances", () => {
	it("start with their params, and stop on withdrawal: abort first, then the stop function", async () => {
		const { def, log } = recorder("acme/t/poll");
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a" } }));
		expect(hasPluginTrigger("t1")).toBe(true);
		await applyPluginTrigger("t1", null);
		expect(log).toEqual(["start a", "abort a", "stop a"]);
		expect(pluginTriggerStatus("t1")).toBeUndefined();
	});

	it("runs two triggers of one kind side by side; withdrawing one leaves the other", async () => {
		const { def, log } = recorder("acme/t/two");
		install(def);
		await applyPluginTrigger("a", artifact("a", def.name, { source: { id: "a" } }));
		await applyPluginTrigger("b", artifact("b", def.name, { source: { id: "b" } }));
		await applyPluginTrigger("a", null);
		expect([hasPluginTrigger("a"), hasPluginTrigger("b")]).toEqual([false, true]);
		expect(log).toEqual(["start a", "start b", "abort a", "stop a"]);
	});

	it("restarts on a changed artifact, and not on the same one sent again", async () => {
		const { def, log } = recorder("acme/t/change");
		install(def);
		const first = artifact("t1", def.name, { source: { id: "a" } });
		await applyPluginTrigger("t1", first);
		// a group reassignment re-sends every artifact; a republish only moves its time
		await applyPluginTrigger("t1", first);
		await applyPluginTrigger("t1", { ...first, publishedAt: new Date(0).toISOString() });
		expect(log).toEqual(["start a"]);
		await applyPluginTrigger("t1", { ...first, source: { id: "b" } });
		await applyPluginTrigger("t1", { ...first, source: { id: "b" }, maxAttempts: 5 });
		expect(log).toEqual(["start a", "abort a", "stop a", "start b", "abort b", "stop b", "start b"]);
	});

	it("ignores every other trigger type", async () => {
		await applyPluginTrigger("q", { ...artifact("q", "x"), type: "kafka" });
		expect(pluginTriggerStatus("q")).toBeUndefined();
	});

	it("does not start without its installed code, and starts once it arrives", async () => {
		const { def, log } = recorder("acme/t/late");
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a" } }));
		expect(hasPluginTrigger("t1")).toBe(false);
		install(def);
		await refreshPluginTriggers();
		expect(log).toEqual(["start a"]);
	});

	it("refuses an artifact published for other code than the installed version", async () => {
		const { def, log } = recorder("acme/t/integrity");
		install(def, undefined, "sha512-other");
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a" } }));
		await refreshPluginTriggers();
		expect([log, hasPluginTrigger("t1"), faults]).toEqual([[], false, []]);
	});

	it("does not start while a secret it names has no value here, and starts once it has", async () => {
		const { def, log } = recorder("acme/t/env");
		install(def);
		appConfig({}, ["TOKEN"]);
		const t = artifact("t1", def.name, { source: { id: "a", token: "cfg:TOKEN" } });
		await applyPluginTrigger("t1", t);
		// the other triggers are not held up by it
		await applyPluginTrigger("t2", artifact("t2", def.name, { source: { id: "b" } }));
		expect(log).toEqual(["start b"]);
		appConfig({ TOKEN: "s3cret" });
		await refreshPluginTriggers();
		expect(log).toEqual(["start b", "start a"]);
		expect(faults).toEqual([]);
	});

	it("on a config change restarts only the triggers whose values changed", async () => {
		const { def, log } = recorder("acme/t/refresh");
		install(def);
		appConfig({ A: "1", B: "1" });
		await applyPluginTrigger("a", artifact("a", def.name, { source: { id: "a", token: "cfg:A" } }));
		await applyPluginTrigger("b", artifact("b", def.name, { source: { id: "b", token: "cfg:B" } }));
		appConfig({ A: "2", B: "1" });
		await refreshPluginTriggers();
		expect(log).toEqual(["start a", "start b", "abort a", "stop a", "start a"]);
		// a value going missing stops the trigger
		appConfig({ B: "1" }, ["A"]);
		await refreshPluginTriggers();
		expect([hasPluginTrigger("a"), hasPluginTrigger("b")]).toEqual([false, true]);
	});

	it("stops every instance on shutdown", async () => {
		const { def, log } = recorder("acme/t/shutdown");
		install(def);
		await applyPluginTrigger("a", artifact("a", def.name, { source: { id: "a" } }));
		await applyPluginTrigger("b", artifact("b", def.name, { source: { id: "b" } }));
		await shutdownPluginTriggers();
		expect(log.filter((l) => l.startsWith("stop")).sort()).toEqual(["stop a", "stop b"]);
		expect([pluginTriggerStatus("a"), pluginTriggerStatus("b")]).toEqual([undefined, undefined]);
	});
});

describe("plugin trigger failures", () => {
	it("a start that throws is retried with backoff, then turned off with the reason", async () => {
		let starts = 0;
		const def = trigger({
			...base,
			name: "acme/t/throws",
			start: async () => {
				starts++;
				throw new Error("cannot connect");
			},
		});
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name));
		await until(() => faults.length, (n) => n > 0, "the fault");
		expect(starts).toBe(3);
		expect(faults).toEqual([
			{
				triggerId: "t1",
				projectId: artifact("t1", def.name).projectId,
				reason: "start failed: cannot connect (failed 3 times in a row)",
			},
		]);
		expect(pluginTriggerStatus("t1")).toBeUndefined();
	});

	it("a start that resolves without a stop function, or never resolves, is a failed start", async () => {
		const noStop = trigger({ ...base, name: "acme/t/nostop", start: async () => undefined as never });
		install(noStop);
		await applyPluginTrigger("t1", artifact("t1", noStop.name));
		expect(await until(() => pluginTriggerStatus("t1")?.lastFailure, Boolean, "a failure")).toBe(
			"start failed: start() must resolve to its stop function",
		);

		const hangs = trigger({ ...base, name: "acme/t/hangs", start: () => new Promise<never>(() => {}) });
		install(hangs);
		await applyPluginTrigger("t2", artifact("t2", hangs.name));
		expect(await until(() => pluginTriggerStatus("t2")?.lastFailure, Boolean, "a failure")).toBe(
			"start failed: it did not resolve within 0.5s",
		);
	});

	it("ctx.fail stops the instance and starts it again", async () => {
		const { def, log } = recorder("acme/t/fail", {
			start: async (ctx: any) => {
				log.push(`start ${ctx.params.id}`);
				ctx.signal.addEventListener("abort", () => log.push(`abort ${ctx.params.id}`));
				if (log.length === 1) setTimeout(() => ctx.fail(new Error("lost the connection")), 0);
				return async () => void log.push(`stop ${ctx.params.id}`);
			},
		});
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a" } }));
		await until(() => log.length, (n) => n >= 4, "the restart");
		await running("t1");
		expect(log).toEqual(["start a", "abort a", "stop a", "start a"]);
		expect(pluginTriggerStatus("t1")).toMatchObject({
			failures: 1,
			lastFailure: "ctx.fail: lost the connection",
		});
	});

	it("a failure after a stable run counts from one again", async () => {
		const fails: ((e: Error) => void)[] = [];
		const def = trigger({
			...base,
			name: "acme/t/stable",
			start: async (ctx) => (fails.push(ctx.fail), async () => {}),
		});
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name));
		fails[0]!(new Error("one"));
		await until(() => fails.length, (n) => n === 2, "a restart");
		await running("t1");
		pluginTriggerLimits.stableMs = 0;
		fails[1]!(new Error("two"));
		await until(() => fails.length, (n) => n === 3, "a second restart");
		expect(pluginTriggerStatus("t1")?.failures).toBe(1);
	});

	it("a stop that hangs is dropped after the timeout; on a restart it counts as a failure", async () => {
		const { def, log } = recorder("acme/t/hung", {
			start: async (ctx: any) => {
				log.push(`start ${ctx.params.id}`);
				return () => new Promise<never>(() => {});
			},
		});
		install(def);
		const t = artifact("t1", def.name, { source: { id: "a" } });
		await applyPluginTrigger("t1", t);
		await applyPluginTrigger("t1", { ...t, source: { id: "b" } });
		expect(pluginTriggerStatus("t1")?.lastFailure).toBe("stop timed out after 0.1s");
		await running("t1");
		expect(log).toEqual(["start a", "start b"]);
		// a withdrawal waits out the same timeout, then carries on
		const started = Date.now();
		await applyPluginTrigger("t1", null);
		expect(Date.now() - started).toBeGreaterThanOrEqual(90);
		expect(pluginTriggerStatus("t1")).toBeUndefined();
	});
});

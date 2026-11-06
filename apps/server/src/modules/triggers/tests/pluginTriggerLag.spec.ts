import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { param } from "@fluxify/sdk/blocks";
import { type AnyTrigger, trigger } from "@fluxify/sdk/triggers";
import { lagLimits, setLagReporter } from "../lagSampler";
import { applyPluginTrigger, hasPluginTrigger, shutdownPluginTriggers } from "../pluginTriggerRuntime";
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

// The plugin trigger runtime starts a trigger's lag sampler beside the trigger
// (#963): only for a kind that defines `lag` and a trigger that holds a target.

const base = { label: "Poll", icon: "./poll.svg" };
const original = { ...lagLimits };
let reports: [string, number | null][];
let starts: string[];

const lagTrigger = (name: string, read: AnyTrigger["lag"] extends infer L ? (L extends { read: infer R } ? R : never) : never) =>
	trigger({
		...base,
		name,
		params: { id: param.string({ required: true }) },
		start: async (ctx) => {
			starts.push(JSON.stringify(ctx.params));
			return async () => {};
		},
		lag: { helpText: "rows", read },
	} as never) as AnyTrigger;
const lagOf = (id: string) => reports.filter(([t]) => t === id).map(([, lag]) => lag);

beforeEach(() => {
	fastLimits();
	faults.length = 0;
	appConfig({});
	Object.assign(lagLimits, { everyMs: 10, timeoutMs: 100 });
	reports = [];
	starts = [];
	setLagReporter((id, lag) => void reports.push([id, lag]));
});
afterEach(async () => {
	await shutdownPluginTriggers();
	uninstallAll();
	Object.assign(lagLimits, original);
	setLagReporter(() => undefined);
});
afterAll(resetLimits);

describe("a plugin trigger's lag sampler", () => {
	it("reads the author's lag.read with the instance's params while the trigger runs", async () => {
		const seen: unknown[] = [];
		const def = lagTrigger("acme/t/lag", async (ctx) => {
			seen.push((ctx.params as { id: string }).id);
			return 12;
		});
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a", lagPerWorker: 50 } }));
		await until(() => lagOf("t1").length, (n) => n >= 2, "two reads");
		expect(lagOf("t1").slice(0, 2)).toEqual([12, 12]);
		expect(seen[0]).toBe("a");
	});

	it("hands the author's start its own params only, never the platform's lagPerWorker", async () => {
		const def = lagTrigger("acme/t/own", async () => 1);
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a", lagPerWorker: 50 } }));
		expect(starts).toEqual([JSON.stringify({ id: "a" })]);
	});

	it("does not read a trigger that holds no target: nothing scales on it, so nothing asks its source", async () => {
		let reads = 0;
		const def = lagTrigger("acme/t/idle", async () => ++reads);
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a" } }));
		await Bun.sleep(60);
		expect(reads).toBe(0);
		expect(reports).toEqual([]);
	});

	it("does not read a kind that defines no lag, whatever its source holds", async () => {
		const def = trigger({
			...base,
			name: "acme/t/plain",
			params: { id: param.string({ required: true }) },
			start: async () => async () => {},
		}) as AnyTrigger;
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a", lagPerWorker: 50 } }));
		await Bun.sleep(40);
		expect(reports).toEqual([]);
	});

	it("keeps running when the target changes: the value is the orchestrator's, not a reason to restart", async () => {
		const def = lagTrigger("acme/t/retarget", async () => 3);
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a", lagPerWorker: 50 } }));
		await until(() => lagOf("t1").length, (n) => n >= 1, "a read");
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a", lagPerWorker: 5 } }));
		expect(starts).toHaveLength(1);
	});

	it("restarts when the target is added or removed, which starts or stops the sampler", async () => {
		const def = lagTrigger("acme/t/toggle", async () => 3);
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a" } }));
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a", lagPerWorker: 50 } }));
		await until(() => lagOf("t1").length, (n) => n >= 1, "a read after the target was added");
		expect(starts).toHaveLength(2);
	});

	it("withdraws its number when the trigger is withdrawn, and reads no more", async () => {
		const def = lagTrigger("acme/t/gone", async () => 7);
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a", lagPerWorker: 50 } }));
		await until(() => lagOf("t1").length, (n) => n >= 1, "a read");
		await applyPluginTrigger("t1", null);
		await until(() => lagOf("t1").at(-1), (last) => last === null, "the number withdrawn");
		const settled = reports.length;
		await Bun.sleep(40);
		expect(reports.length).toBe(settled);
	});

	it("a failing read is unknown, and never counts against the trigger: it keeps running, nothing is reported", async () => {
		const def = lagTrigger("acme/t/broken", async () => {
			throw new Error("source down");
		});
		install(def);
		await applyPluginTrigger("t1", artifact("t1", def.name, { source: { id: "a", lagPerWorker: 50 } }));
		await until(() => lagOf("t1").length, (n) => n >= 4, "four failed reads");
		expect(new Set(lagOf("t1"))).toEqual(new Set([null]));
		expect(hasPluginTrigger("t1")).toBe(true);
		expect(faults).toEqual([]);
	});
});

import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { param } from "@fluxify/sdk/blocks";
import { poll, type TriggerContext, trigger } from "@fluxify/sdk/triggers";
import { applyPluginTrigger, shutdownPluginTriggers } from "../pluginTriggerRuntime";
import {
	appConfig,
	artifact,
	fastLimits,
	faults,
	install,
	resetLimits,
	uninstallAll,
	until,
	workflow,
} from "./pluginTriggerHarness";

const KIND = "acme/t/off";
let starts = 0;

/** a running trigger whose `tick` is what `run` does; its secret param names TOKEN */
async function polling(run: (ctx: TriggerContext) => unknown, onError?: () => void) {
	const def = trigger({
		label: "Off",
		icon: "./o.svg",
		name: KIND,
		params: { token: param.secret() },
		start: async (ctx) => {
			starts++;
			return poll(ctx as never, { every: 1, tick: async () => void (await run(ctx as never)), onError });
		},
	});
	install(def);
	await applyPluginTrigger("t1", artifact("t1", KIND, { source: { token: "cfg:TOKEN" } }));
}
const turnedOff = () => until(() => faults.length, (n) => n > 0, "the fault");

beforeEach(() => {
	fastLimits();
	starts = 0;
	faults.length = 0;
	appConfig({ TOKEN: "s3cret", OTHER: "o" });
	workflow("return { successful: true };");
});
afterEach(async () => {
	await shutdownPluginTriggers();
	uninstallAll();
});
afterAll(resetLimits);

describe("a permission denial", () => {
	it("turns the trigger off at the first one, with no restart", async () => {
		await polling((ctx) => ctx.getConfig("OTHER"));
		await turnedOff();
		await Bun.sleep(30);
		expect(starts).toBe(1);
		expect(faults).toHaveLength(1);
		expect(faults[0]!.reason).toStartWith("permission denied: trigger acme/t/off: getConfig('OTHER')");
	});

	it("does so even when the author's code catches it", async () => {
		await polling((ctx) => {
			try {
				ctx.getConfig("OTHER");
			} catch {}
		});
		await turnedOff();
		expect(faults[0]!.reason).toStartWith("permission denied");
	});

	it("does so when it happens in start", async () => {
		const def = trigger({
			label: "Off",
			icon: "./o.svg",
			name: KIND,
			start: async (ctx) => {
				starts++;
				ctx.getConfig("OTHER");
				return async () => {};
			},
		});
		install(def);
		await applyPluginTrigger("t1", artifact("t1", KIND));
		await turnedOff();
		await Bun.sleep(30);
		expect(starts).toBe(1);
	});

	it("is not what reading the key its secret param names is", async () => {
		await polling((ctx) => ctx.getConfig(ctx.params.token as string));
		await Bun.sleep(30);
		expect(faults).toEqual([]);
	});
});

describe("failed ticks", () => {
	it("turn the trigger off after the limit in a row, with no restart", async () => {
		await polling(() => {
			throw new Error("boom");
		});
		await turnedOff();
		expect(starts).toBe(1);
		expect(faults[0]!.reason).toBe("tick failed: boom (failed 3 times in a row)");
	});

	it("start the count again after a tick that works", async () => {
		let n = 0;
		await polling(() => {
			if (++n % 3 !== 0) throw new Error("boom");
		});
		await until(() => n, (seen) => seen >= 12, "the ticks");
		expect(faults).toEqual([]);
	});

	it("are not counted when onError lets them pass", async () => {
		let n = 0;
		await polling(
			() => {
				n++;
				throw new Error("boom");
			},
			() => {},
		);
		await until(() => n, (seen) => seen >= 6, "the ticks");
		expect(faults).toEqual([]);
	});
});

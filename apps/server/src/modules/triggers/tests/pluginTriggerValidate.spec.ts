import { afterEach, describe, expect, it } from "bun:test";
import { param } from "@fluxify/sdk/blocks";
import { trigger } from "@fluxify/sdk/triggers";
import { validatePluginTrigger } from "../pluginTriggerValidate";
import { appConfig, install, PROJECT, uninstallAll } from "./pluginTriggerHarness";

const base = { label: "Poll", icon: "./poll.svg", start: async () => async () => {} };

let seen: AbortSignal | undefined;
const checking = trigger({
	...base,
	name: "acme/validate/poll",
	params: { every: param.number({ default: 5 }), token: param.secret() },
	validate: async (ctx) => {
		seen = ctx.signal;
		if (ctx.params.every > 60) throw new Error("every must be at most 60 seconds");
		if (ctx.params.token && ctx.getConfig(ctx.params.token) !== "ok")
			throw new Error("the token was refused");
		// what only a running instance has is not there
		const extra = ["emit", "fail", "reportTick"].filter((k) => k in ctx);
		return [`every ${ctx.params.every}`, ...extra];
	},
});

afterEach(() => uninstallAll());

describe("validatePluginTrigger", () => {
	it("runs the installed code's validate with the params defaulted and this env's app config", async () => {
		install(checking);
		appConfig({ TOKEN: "ok" });
		expect(await validatePluginTrigger(PROJECT, checking.name, { token: "cfg:TOKEN" })).toEqual([
			"every 5",
		]);
		// released afterwards: nothing it opened outlives the check
		expect(seen?.aborted).toBe(true);
	});

	it("rejects with the author's error", async () => {
		install(checking);
		appConfig({ TOKEN: "nope" });
		await expect(validatePluginTrigger(PROJECT, checking.name, { every: 61 })).rejects.toThrow(
			"every must be at most 60 seconds",
		);
		await expect(
			validatePluginTrigger(PROJECT, checking.name, { token: "cfg:TOKEN" }),
		).rejects.toThrow("the token was refused");
	});

	it("a kind with no validate has nothing to say; one not installed is named", async () => {
		const plain = trigger({ ...base, name: "acme/validate/plain" });
		install(plain);
		expect(await validatePluginTrigger(PROJECT, plain.name, {})).toEqual([]);
		await expect(validatePluginTrigger(PROJECT, "acme/validate/gone", {})).rejects.toThrow(
			"No installed plugin here provides trigger acme/validate/gone",
		);
	});

	it("gives up on a hung validate, aborting its signal", async () => {
		let signal: AbortSignal | undefined;
		const hung = trigger({
			...base,
			name: "acme/validate/hung",
			validate: (ctx) => ((signal = ctx.signal), new Promise<void>(() => {})),
		});
		install(hung);
		await expect(validatePluginTrigger(PROJECT, hung.name, {}, 20)).rejects.toThrow(
			"validate() did not finish within 0.02s",
		);
		expect(signal?.aborted).toBe(true);
	});
});

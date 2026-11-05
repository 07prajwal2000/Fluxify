import { describe, expect, it } from "bun:test";
import { param } from "../blocks.js";
import { validateTrigger } from "../testing.js";
import { type AnyTrigger, toTriggerEntry, trigger, triggerEntrySchema } from "../triggers.js";

const base = {
	name: "acme/t/poll",
	label: "Poll",
	icon: "./poll.svg",
	start: async () => async () => {},
};

const checking = trigger({
	...base,
	permissions: { integrations: ["database"] },
	params: {
		db: param.integration({ kind: "database", required: true }),
		every: param.number({ default: 5 }),
		token: param.secret(),
	},
	validate: async (ctx) => {
		if (ctx.params.every > 60) throw new Error("every must be at most 60 seconds");
		const db = await ctx.integrations.get(ctx.params.db);
		if (!db) throw new Error("no database");
		ctx.logger.logInfo(`token ${ctx.getConfig(ctx.params.token!)}`);
		return ctx.params.every < 2 ? ["polling every second is heavy"] : [];
	},
});

const options = (params: Record<string, unknown>) => ({
	params: { db: "db-1", token: "cfg:TOKEN", ...params } as never,
	integrations: { "db-1": { kind: "database", client: {} } } as never,
	appConfig: { TOKEN: "s3cret" },
});

describe("trigger validate", () => {
	it("the manifest says whether a trigger validates; older entries without it still parse", () => {
		expect(toTriggerEntry(checking).validate).toBe(true);
		expect(toTriggerEntry(trigger(base)).validate).toBe(false);
		const { validate: _, ...older } = toTriggerEntry(trigger(base));
		expect(triggerEntrySchema.safeParse(older).success).toBe(true);
	});

	it("refuses a validate that is not a function", () => {
		expect(() => trigger({ ...base, validate: true } as unknown as AnyTrigger)).toThrow(
			"trigger acme/t/poll: validate must be a function",
		);
	});

	it("gets its params defaulted, the granted integrations and app config", async () => {
		const result = await validateTrigger(checking, options({}));
		expect(result.warnings).toEqual([]);
		expect(result.logs.map((l) => l.value)).toEqual(["token s3cret"]);
	});

	it("returned strings are warnings, a throw is the refusal", async () => {
		expect((await validateTrigger(checking, options({ every: 1 }))).warnings).toEqual([
			"polling every second is heavy",
		]);
		await expect(validateTrigger(checking, options({ every: 61 }))).rejects.toThrow(
			"every must be at most 60 seconds",
		);
		// params are checked before validate sees them
		await expect(validateTrigger(checking, options({ db: undefined }))).rejects.toThrow(
			"param 'db' is required",
		);
	});

	it("a trigger with no validate has nothing to say", async () => {
		expect((await validateTrigger(trigger(base))).warnings).toEqual([]);
	});

	it("refuses a hung validate and a result that is not strings", async () => {
		let signal: AbortSignal | undefined;
		const hung = trigger({
			...base,
			validate: (ctx) => ((signal = ctx.signal), new Promise<void>(() => {})),
		});
		await expect(validateTrigger(hung, { timeoutMs: 20 })).rejects.toThrow(
			"trigger acme/t/poll: validate() did not resolve within 20 ms",
		);
		expect(signal?.aborted).toBe(true);
		const odd = trigger({ ...base, validate: async () => [1] as never });
		await expect(validateTrigger(odd)).rejects.toThrow("must resolve to nothing or an array of strings");
	});
});

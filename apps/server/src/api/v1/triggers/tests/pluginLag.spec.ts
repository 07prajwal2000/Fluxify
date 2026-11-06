import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ValidationError } from "../../../../errors/validationError";
import * as triggerKinds from "../../../../modules/plugins/triggerKinds";
import { assertConnector } from "../connectors";
import { settleLagOf } from "../pluginLag";

const row = {
	name: "acme/t",
	version: "1.0.0",
	integrity: "sha-1",
	approval: "approved",
	devEnabled: true,
	prodEnabled: true,
};
const entry = (lag?: { default?: number; helpText: string }) => ({
	name: "acme/t/poll",
	label: "Poll",
	icon: "data:",
	permissions: {},
	params: { table: { type: "string" } },
	retry: false,
	...(lag ? { lag } : {}),
});
const provide = (lag?: { default?: number; helpText: string }) =>
	spyOn(triggerKinds, "findTriggerKind").mockResolvedValue({ row, entry: entry(lag) } as never);

const base = { type: "plugin:acme/t/poll", projectId: "p1" };
const save = (source: Record<string, unknown> | undefined, state: Record<string, unknown> = {}) =>
	assertConnector({ ...base, source, probe: false, ...state });
const refusal = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => undefined,
		(e) => e,
	);
	expect(error).toBeInstanceOf(ValidationError);
	return (error as ValidationError).message + JSON.stringify((error as ValidationError).errors ?? "");
};

beforeEach(() => mock.restore());
afterEach(() => mock.restore());

describe("lagPerWorker on a plugin trigger (#963)", () => {
	it("is filled with the plugin's default when the user set none, once, before the save", async () => {
		provide({ default: 50, helpText: "rows" });
		expect(await settleLagOf({ ...base, source: { table: "t" } })).toEqual({
			table: "t",
			lagPerWorker: 50,
		});
		expect(await settleLagOf({ ...base, source: undefined })).toEqual({ lagPerWorker: 50 });
		// an empty field is "set none", not a value
		expect(await settleLagOf({ ...base, source: { lagPerWorker: "" } })).toEqual({ lagPerWorker: 50 });
	});

	it("keeps the user's value over the default", async () => {
		provide({ default: 50, helpText: "rows" });
		expect(await settleLagOf({ ...base, source: { lagPerWorker: 7 } })).toEqual({ lagPerWorker: 7 });
	});

	it("is left empty with no default, and a new trigger then fails validation naming the field", async () => {
		provide({ helpText: "rows" });
		expect(await settleLagOf({ ...base, source: { table: "t" } })).toEqual({ table: "t" });
		expect(await refusal(save({ table: "t" }, { creating: true }))).toContain("source.lagPerWorker");
	});

	it("accepts a new trigger once it has a value, from the user or from the default", async () => {
		provide({ helpText: "rows" });
		await expect(save({ lagPerWorker: 20 }, { creating: true })).resolves.toEqual([]);
		provide({ default: 50, helpText: "rows" });
		const settled = await settleLagOf({ ...base, source: {} });
		await expect(save(settled, { creating: true })).resolves.toEqual([]);
	});

	it("refuses a value that is not a whole number of at least 1", async () => {
		provide({ default: 50, helpText: "rows" });
		for (const bad of [0, -1, 2.5, "ten"])
			expect(await refusal(save({ lagPerWorker: bad }))).toContain("source.lagPerWorker");
	});

	it("never refuses an edit of a trigger that had no value: it keeps scaling on cpu and memory", async () => {
		provide({ helpText: "rows" });
		await expect(save({ table: "t" })).resolves.toEqual([]);
		await expect(save({ table: "t" }, { hadLag: false })).resolves.toEqual([]);
	});

	it("does refuse an edit that clears a value the trigger had, with no default to put back", async () => {
		provide({ helpText: "rows" });
		expect(await refusal(save({ table: "t" }, { hadLag: true }))).toContain("source.lagPerWorker");
	});

	it("asks for nothing of a kind with no lag, and leaves its source alone", async () => {
		provide(undefined);
		await expect(save({ table: "t" }, { creating: true })).resolves.toEqual([]);
		expect(await settleLagOf({ ...base, source: { table: "t" } })).toEqual({ table: "t" });
	});

	it("leaves a built-in trigger's source alone", async () => {
		const source = { topics: ["a"] };
		expect(await settleLagOf({ type: "kafka", projectId: "p1", source })).toBe(source);
	});
});

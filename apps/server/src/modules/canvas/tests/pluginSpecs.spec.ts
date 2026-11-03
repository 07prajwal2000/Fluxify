import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

mock.module("../../../db", () => ({ db: {} }));
mock.module("../../../db/redis", () => ({ publishMessage: async () => {} }));

import { ValidationError } from "../../../errors/validationError";
import * as audit from "../../audit";
import * as compile from "../../plugins/compile";
import * as paramCheck from "../../plugins/paramCheck";
import { assertPluginBlockParams } from "../pluginSpecs";

const TYPE = "acme/x/step";
const entry = (params: Record<string, unknown>, permissions = {}) =>
	({ name: TYPE, label: "Step", permissions, params }) as never;

const parent = { type: "route", id: "r1" } as const;
const block = (data: unknown, id = "b1") => ({ id, type: TYPE, data });
const refusals = async (blocks: ReturnType<typeof block>[]) => {
	try {
		await assertPluginBlockParams(parent, blocks);
	} catch (error) {
		expect(error).toBeInstanceOf(ValidationError);
		return (error as ValidationError).errors;
	}
	return [];
};

const entries = spyOn(compile, "canvasPluginEntries");
const lookup = spyOn(paramCheck, "integrationValueProblem");

beforeEach(() => {
	spyOn(audit, "projectIdOf").mockReturnValue(async () => "p1");
	lookup.mockReset().mockResolvedValue(undefined);
	entries.mockReset();
});

const withParams = (params: Record<string, unknown>, permissions = {}) =>
	entries.mockResolvedValue({ [TYPE]: entry(params, permissions) });

describe("assertPluginBlockParams", () => {
	it("takes a block whose params fit", async () => {
		withParams({ a: { type: "string", required: true }, n: { type: "number", min: 1 } });
		expect(await refusals([block({ a: "x", n: 2 })])).toEqual([]);
	});

	it("takes a plain block and a plugin block of a plugin it does not know", async () => {
		withParams({ a: { type: "string", required: true } });
		await assertPluginBlockParams(parent, [{ id: "x", type: "response", data: {} }]);
		await assertPluginBlockParams(parent, [{ id: "y", type: "acme/other/block", data: {} }]);
	});

	it.each([
		["a missing required param", { a: { type: "string", required: true } }, {}, "Step: a: is required"],
		["a blank required param", { a: { type: "string", required: true } }, { a: "  " }, "Step: a: is required"],
		[
			"a select outside its options",
			{ s: { type: "select", options: ["x", "y"] } },
			{ s: "z" },
			'Step: s: must be one of x, y, got "z"',
		],
		["the wrong type", { b: { type: "boolean" } }, { b: "yes" }, "Step: b: must be a boolean, got string"],
		["a number given as text", { n: { type: "number" } }, { n: "abc" }, "Step: n: must be a number, got string"],
		[
			"a number out of bounds",
			{ n: { type: "number", max: 10 } },
			{ n: 11 },
			"Step: n: must be at most 10, got 11",
		],
		[
			"too few items",
			{ l: { type: "array", min: 2 } },
			{ l: ["a"] },
			"Step: l: needs at least 2 items, got 1",
		],
		["a repeated key", { k: { type: "keyValue" } }, { k: { a: 1, " a": 2 } }, "Step: k: has the key 'a' twice"],
		[
			"a string that is too short",
			{ s: { type: "string", minLength: 3 } },
			{ s: "ab" },
			"Step: s: must be at least 3 characters, got 2",
		],
		[
			"a string that does not match its pattern",
			{ s: { type: "string", pattern: "^[a-z]+$" } },
			{ s: "AB1" },
			"Step: s: must match ^[a-z]+$",
		],
	])("refuses %s", async (_name, params, data, message) => {
		withParams(params);
		expect(await refusals([block(data)])).toEqual([{ field: "b1", message }]);
	});

	it("skips a js: value and a hidden param", async () => {
		withParams({
			mode: { type: "select", options: ["a", "b"], default: "a" },
			n: { type: "number", min: 5 },
			h: { type: "string", required: true, visibleWhen: { mode: "b" } },
		});
		expect(await refusals([block({ n: "js: input.n" })])).toEqual([]);
	});

	it("reports every bad block in one error", async () => {
		withParams({ a: { type: "string", required: true } });
		expect(await refusals([block({}, "b1"), block({ a: "x" }, "b2"), block({}, "b3")])).toEqual([
			{ field: "b1", message: "Step: a: is required" },
			{ field: "b3", message: "Step: a: is required" },
		]);
	});

	describe("integration params", () => {
		const params = { db: { type: "integration", kind: "kv" } };
		it("refuses what the project check refuses, naming the block", async () => {
			withParams(params, { integrations: ["kv"] });
			lookup.mockResolvedValue("no integration nope in this project");
			expect(await refusals([block({ db: "nope" })])).toEqual([
				{ field: "b1", message: "Step: db: no integration nope in this project" },
			]);
			expect(lookup).toHaveBeenCalledWith(
				{ label: `block ${TYPE}`, granted: ["kv"] },
				params.db,
				"nope",
				"p1",
				undefined,
				false,
			);
		});
		it("passes unknownOk on for an import", async () => {
			withParams(params);
			await assertPluginBlockParams(parent, [block({ db: "x" })], undefined, true);
			expect(lookup.mock.calls[0]?.[5]).toBe(true);
		});
		it("takes an id the project has, an empty one, and a js: expression unlooked", async () => {
			withParams(params);
			expect(await refusals([block({ db: "ok" }), block({}, "b2"), block({ db: "js: id" }, "b3")])).toEqual([]);
			expect(lookup).toHaveBeenCalledTimes(1);
		});
		it("does not look a hidden param's stale id up", async () => {
			withParams({ mode: { type: "select", options: ["a", "b"], default: "a" }, db: { ...params.db, visibleWhen: { mode: "b" } } });
			lookup.mockResolvedValue("no integration old in this project");
			expect(await refusals([block({ db: "old" })])).toEqual([]);
		});
	});
});

import { describe, expect, it } from "bun:test";
import { BlockTypes } from "@fluxify/blocks";
import { Hono } from "hono";
import { validator } from "hono-openapi";
import { blockDataValidator, requestBodyValidator } from "../blockDataValidator";
import { takeDroppedWarnings } from "../droppedFields";
import { canvasChangesSchema } from "../types";
import { customBlockNames } from "../../../loaders/customBlocksLoader";
import type { CanvasChanges } from "../types";

/**
 * A new block type is registered in several places, and this validator is the
 * one nobody remembers — a block missing here saves nowhere, with only
 * "Unknown block type" to go on. So assert the whole enum rather than the block
 * of the day.
 */
const changes = (type: string, data: Record<string, unknown> = {}): CanvasChanges =>
	({
		actionsToPerform: { blocks: [], edges: [] },
		changes: {
			blocks: [{ id: "b1", type, data, position: { x: 0, y: 0 } }],
			edges: [],
		},
	}) as unknown as CanvasChanges;

describe("every block type the engine knows", () => {
	for (const type of Object.values(BlockTypes)) {
		it(`has a schema for ${type}`, () => {
			// Empty data may be rejected as invalid; what must not happen is the
			// type itself going unrecognised.
			try {
				blockDataValidator(changes(type));
			} catch (error) {
				expect((error as Error).message).not.toStartWith("Unknown block type");
			}
		});
	}
});

describe("the switch block", () => {
	it("saves with no cases connected and fills in an empty order and conditions", () => {
		const data = changes(BlockTypes.switch, { blockName: "Route by status" });
		expect(() => blockDataValidator(data)).not.toThrow();
		expect(data.changes.blocks[0]!.data).toMatchObject({
			order: [],
			conditions: {},
			useValue: false,
			value: "",
			matches: {},
			blockName: "Route by status",
		});
	});

	it("keeps a value script and each case's match value", () => {
		const data = changes(BlockTypes.switch, {
			useValue: true,
			value: "return input.status;",
			matches: { paid: "paid", notFound: "js: return 404;" },
		});
		blockDataValidator(data);
		expect(data.changes.blocks[0]!.data).toMatchObject({
			useValue: true,
			value: "return input.status;",
			matches: { paid: "paid", notFound: "js: return 404;" },
		});
	});

	const errors = (run: () => void) => {
		try {
			run();
		} catch (error) {
			return (error as { errors?: { field: string; message: string }[] }).errors;
		}
		return [];
	};

	// #673: refused with a message naming the block and the field
	it("rejects a match value that is not text", () => {
		const data = changes(BlockTypes.switch, { useValue: true, matches: { paid: 1 } });
		expect(errors(() => blockDataValidator(data))).toEqual([
			{ field: "b1", message: "switch: matches.paid must be a string" },
		]);
	});

	it("keeps each case's condition and the order they are checked in", () => {
		const data = changes(BlockTypes.switch, {
			order: ["paid", "refunded"],
			conditions: { paid: 'return input.status === "paid";', refunded: "return true;" },
		});
		blockDataValidator(data);
		expect(data.changes.blocks[0]!.data).toMatchObject({
			order: ["paid", "refunded"],
			conditions: { paid: 'return input.status === "paid";', refunded: "return true;" },
		});
	});

	it("rejects a condition that is not text, or an order that is not a list", () => {
		expect(
			errors(() => blockDataValidator(changes(BlockTypes.switch, { conditions: { paid: 42 } }))),
		).toEqual([{ field: "b1", message: "switch: conditions.paid must be a string" }]);
		expect(
			errors(() => blockDataValidator(changes(BlockTypes.switch, { order: "paid" }))),
		).toEqual([{ field: "b1", message: "switch: order must be an array" }]);
	});
});

describe("the trigger workflow block", () => {
	it("saves before a workflow has been picked", () => {
		const data = changes(BlockTypes.triggerWorkflow, { blockName: "Kick off" });
		expect(() => blockDataValidator(data)).not.toThrow();
		expect(data.changes.blocks[0]!.data).toMatchObject({
			workflowId: "",
			useInput: false,
			blockName: "Kick off",
		});
	});

	it("keeps the workflow and data it was given", () => {
		const data = changes(BlockTypes.triggerWorkflow, {
			workflowId: "wf-1",
			useInput: false,
			data: "js: return { id: input.id };",
		});
		blockDataValidator(data);
		expect(data.changes.blocks[0]!.data).toMatchObject({
			workflowId: "wf-1",
			data: "js: return { id: input.id };",
		});
	});
});

describe("save output to variable", () => {
	const transformer = (name: string, enabled = true) =>
		changes(BlockTypes.transformer, {
			blockName: "Shape User",
			fieldMap: {},
			saveAsVariable: { enabled, name },
		});
	const messages = (run: () => void) => {
		try {
			run();
		} catch (error) {
			return (error as { errors?: { message: string }[] }).errors?.map((e) => e.message);
		}
		return [];
	};

	it("rejects an invalid name, naming the block", () => {
		expect(messages(() => blockDataValidator(transformer("a-b")))).toEqual([
			"Shape User: Variable name must start with a letter, _ or $ and contain only letters, digits, _ and $",
		]);
	});

	it("rejects an invalid or empty name", () => {
		expect(messages(() => blockDataValidator(transformer("1abc")))[0]).toContain("must start with a letter");
		expect(messages(() => blockDataValidator(transformer("  ")))[0]).toContain("Variable name is required");
	});

	it("rejects it on a custom block too", () => {
		// a registered custom block skips schema validation, so this is its only check
		customBlockNames.add("weather_lookup");
		try {
			const data = changes("weather_lookup", { saveAsVariable: { enabled: true, name: "9lives" } });
			expect(messages(() => blockDataValidator(data))).toEqual([
				"weather_lookup: Variable name must start with a letter, _ or $ and contain only letters, digits, _ and $",
			]);
		} finally {
			customBlockNames.delete("weather_lookup");
		}
	});

	it("keeps the setting when the block's data is normalized (#673)", () => {
		const data = transformer("users");
		blockDataValidator(data);
		expect(data.changes.blocks[0]!.data).toMatchObject({ saveAsVariable: { enabled: true, name: "users" } });
	});

	it("accepts a valid name, a padded one, a reserved word, and any name while the toggle is off", () => {
		expect(() => blockDataValidator(transformer("users"))).not.toThrow();
		expect(() => blockDataValidator(transformer("  users  "))).not.toThrow();
		expect(() => blockDataValidator(transformer("class"))).not.toThrow();
		expect(() => blockDataValidator(transformer("a-b", false))).not.toThrow();
	});
});

describe("saving keeps the user's data (#679)", () => {
	const base = { connection: "c1", tableName: "users", useParam: false };

	it("keeps db_insert data.value columns", () => {
		const data = changes(BlockTypes.db_insert, {
			...base,
			data: { source: "raw", value: { name: "Ann", age: 3 } },
		});
		blockDataValidator(data);
		expect((data.changes.blocks[0]!.data as any).data.value).toEqual({ name: "Ann", age: 3 });
	});

	it("keeps db_update data.value columns", () => {
		const data = changes(BlockTypes.db_update, {
			...base,
			conditions: [],
			data: { source: "raw", value: { points: { op: "inc", value: 10 } } },
		});
		blockDataValidator(data);
		expect((data.changes.blocks[0]!.data as any).data.value).toEqual({
			points: { op: "inc", value: 10 },
		});
	});

	it("keeps db_insertbulk rows", () => {
		const data = changes(BlockTypes.db_insertbulk, {
			...base,
			data: { source: "raw", value: [{ a: 1 }, { b: 2 }] },
		});
		blockDataValidator(data);
		expect((data.changes.blocks[0]!.data as any).data.value).toEqual([{ a: 1 }, { b: 2 }]);
	});

	it("keeps the keys of the free-form maps", () => {
		const data = changes(BlockTypes.httprequest, {
			url: "https://x.test",
			method: "POST",
			headers: { "X-Any": "1", Other: "2" },
			body: { a: { b: [1, 2] } },
		});
		blockDataValidator(data);
		expect(data.changes.blocks[0]!.data).toMatchObject({
			headers: { "X-Any": "1", Other: "2" },
			body: { a: { b: [1, 2] } },
		});
	});

	it("keeps custom block data as given", () => {
		customBlockNames.add("weather_lookup");
		try {
			const data = changes("weather_lookup", { city: "Oslo", extra: { deep: 1 } });
			expect(blockDataValidator(data)).toEqual([]);
			expect(data.changes.blocks[0]!.data).toEqual({ city: "Oslo", extra: { deep: 1 } });
		} finally {
			customBlockNames.delete("weather_lookup");
		}
	});
});

describe("fields a block does not have (#703)", () => {
	it("drops them, fills defaults, and warns", () => {
		const data = changes(BlockTypes.errorHandler, {
			blockName: "onError",
			statusCode: 500,
			transform: "return 1;",
		});
		expect(blockDataValidator(data)).toEqual([
			{
				severity: "warning",
				blockId: "b1",
				message: "onError: removed unknown field(s) statusCode, transform",
			},
		]);
		expect(data.changes.blocks[0]!.data).toEqual({ blockName: "onError", blockDescription: "Description" });
	});

	it("names nested fields by path and falls back to the block type", () => {
		const data = changes(BlockTypes.switch, { extra: 1, conditions: {} });
		const [warning] = blockDataValidator(data);
		expect(warning!.message).toBe("switch: removed unknown field(s) extra");
	});

	it("does not warn when nothing was dropped, and keeps saveAsVariable", () => {
		const data = changes(BlockTypes.errorHandler, { saveAsVariable: { enabled: false, name: "x" } });
		expect(blockDataValidator(data)).toEqual([]);
		expect(data.changes.blocks[0]!.data).toMatchObject({ saveAsVariable: { enabled: false, name: "x" } });
	});
});

describe("the save middleware (#703)", () => {
	it("hands the handler the parsed data and the warnings", async () => {
		const app = new Hono();
		app.put(
			"/",
			validator("json", canvasChangesSchema),
			requestBodyValidator,
			(c) => {
				const body = c.req.valid("json");
				return c.json({ data: body.changes.blocks[0]!.data, warnings: takeDroppedWarnings(body) });
			},
		);
		const res = await app.request("/", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(changes(BlockTypes.errorHandler, { statusCode: 500 })),
		});
		const out = (await res.json()) as { data: object; warnings: { message: string }[] };
		expect(out.data).not.toHaveProperty("statusCode");
		expect(out.warnings.map((w) => w.message)).toEqual([
			"error_handler: removed unknown field(s) statusCode",
		]);
	});
});

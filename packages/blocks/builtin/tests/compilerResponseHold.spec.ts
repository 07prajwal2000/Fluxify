import { afterEach, describe, expect, it } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import { compileGraph } from "../../compiler";
import { runWithMiddlewares } from "../../middleware";
import { customBlockNames, registerCustomBlock, unregisterCustomBlock } from "../customBlock";
import { responseAiDescription } from "../response";
import { block, createContext, edge } from "./compilerTestHelpers";

const PROJECT = "proj-1";

const route = (data: Record<string, unknown>) =>
	compileGraph(
		[block("1", BlockTypes.entrypoint), block("2", BlockTypes.response, { httpCode: "200", ...data })],
		[edge("1", "2")],
		{ projectId: PROJECT },
	);

afterEach(() => {
	for (const name of customBlockNames(PROJECT)) unregisterCustomBlock(PROJECT, name);
});

describe("Response block: Hold connection (#1024)", () => {
	it("marks the result held, with the body untouched", async () => {
		expect(await route({ holdConnection: true }).run(createContext(), { hi: 1 })).toEqual({
			successful: true,
			continueIfFail: true,
			responded: true,
			held: true,
			output: { httpCode: "200", body: { hi: 1 } },
		});
	});

	it("emits nothing new when off", async () => {
		for (const data of [{}, { holdConnection: false }]) {
			const { run, source } = route(data);
			expect(source).not.toContain("held");
			expect((await run(createContext(), 1)).held).toBeUndefined();
		}
	});

	it("holds the transformed body", async () => {
		const result = await route({
			holdConnection: true,
			transformEnabled: true,
			transformScript: "return { wrapped: input };",
		}).run(createContext(), 3);
		expect(result.held).toBe(true);
		expect(result.output.body).toEqual({ wrapped: 3 });
	});

	it("stays held through an after middleware that does not respond", async () => {
		registerCustomBlock(
			PROJECT,
			"tag",
			[block("m1", BlockTypes.entrypoint), block("m2", BlockTypes.jsrunner, { value: "return input.body;" })],
			[edge("m1", "m2")],
		);
		const result = await runWithMiddlewares(createContext(), 5, route({ holdConnection: true }).run, {
			before: [],
			after: [{ id: "mw-tag", name: "tag", blocks: ["tag"] }],
		});
		expect(result?.held).toBe(true);
		expect(result?.output).toEqual({ httpCode: 200, body: 5 });
	});

	it("tells the AI about the field", () => {
		expect(responseAiDescription.jsonSchema).toContain("holdConnection");
		expect(responseAiDescription.description).toContain("holdConnection");
	});
});

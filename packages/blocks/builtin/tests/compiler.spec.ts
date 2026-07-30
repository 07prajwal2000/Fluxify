import { describe, it, expect } from "bun:test";
import { JsVM } from "@fluxify/lib";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType, EdgeDTOSchemaType } from "../../builderTypes";

function createContext() {
	const vars: Record<string, any> = {};
	return {
		vm: new JsVM(vars),
		route: "/test",
		apiId: "api-1",
		projectId: "proj-1",
		vars,
		stopper: { timeoutEnd: 0, duration: 10000 },
	} as any;
}

const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

const edge = (from: string, to: string, toHandle = "source") => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle,
});

describe("compileGraph", () => {
	it("compiles entrypoint -> setvar -> getvar -> jsrunner -> response", async () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.setvar, { key: "x", value: "js:return input.n * 2" }),
			block("3", BlockTypes.getvar, { key: "x" }),
			block("4", BlockTypes.jsrunner, { value: "return input + 1" }),
			block("5", BlockTypes.response, { httpCode: "200" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("1", "2"),
			edge("2", "3"),
			edge("3", "4"),
			edge("4", "5"),
		];

		const { run, source } = compileGraph(blocks, edges);
		expect(source).toContain('vars["x"]');

		const ctx = createContext();
		const result = await run(ctx, { n: 21 });

		expect(ctx.vars.x).toBe(42);
		expect(result).toEqual({
			successful: true,
			continueIfFail: true,
			output: { httpCode: "200", body: 43 },
		});
	});

	it("returns the flowing value when nothing is connected", async () => {
		const { run } = compileGraph([block("1", BlockTypes.entrypoint)], []);
		expect(await run(createContext(), { hello: "world" })).toEqual({
			successful: true,
			continueIfFail: true,
			output: { hello: "world" },
		});
	});

	it("rejects cycles and unknown block types", () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.getvar, { key: "x" }),
		];
		expect(() =>
			compileGraph(blocks, [edge("1", "2"), edge("2", "1")]),
		).toThrow(/Cycle/);

		expect(() =>
			compileGraph(
				[block("1", BlockTypes.entrypoint), block("2", BlockTypes.db_getall, {})],
				[edge("1", "2")],
			),
		).toThrow(/No codegen/);
	});
});

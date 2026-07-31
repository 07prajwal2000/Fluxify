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

	it("inlines user JS: bare identifiers read and write context vars", async () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			// bare assignment must land in vars, not on the real globalThis
			block("2", BlockTypes.jsrunner, { value: "total = input.a + input.b; return total;" }),
			// a later block must see what the previous one assigned, and reach globals
			block("3", BlockTypes.jsrunner, { value: "return Math.max(total, input);" }),
			block("4", BlockTypes.response, { httpCode: "200" }),
		];
		const edges: EdgeDTOSchemaType = [edge("1", "2"), edge("2", "3"), edge("3", "4")];

		const ctx = createContext();
		const result = await compileGraph(blocks, edges).run(ctx, { a: 2, b: 3 });

		expect(ctx.vars.total).toBe(5);
		expect((globalThis as any).total).toBeUndefined();
		expect(result.output.body).toBe(5);
		// `input` is the flowing value, and it no longer leaks into vars
		expect(ctx.vars.input).toBeUndefined();
	});

	it("inlines conditions, keeping the sandbox untouched", async () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.if, {
				conditions: [
					{ lhs: "js:return input.n", rhs: 10, operator: "gt", chain: "and" },
				],
			}),
			block("3", BlockTypes.response, { httpCode: "200" }),
			block("4", BlockTypes.response, { httpCode: "400" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("1", "2"),
			edge("2", "3", "success"),
			edge("2", "4", "failure"),
		];
		const { run, source } = compileGraph(blocks, edges);
		expect(source).not.toContain("ctx.vm");

		expect((await run(createContext(), { n: 42 })).output.httpCode).toBe("200");
		expect((await run(createContext(), { n: 1 })).output.httpCode).toBe("400");
	});

	it("still routes through the sandbox when inlineJs is off", async () => {
		const blocks = [
			block("1", BlockTypes.entrypoint),
			block("2", BlockTypes.jsrunner, { value: "shared = input * 2; return shared;" }),
			block("3", BlockTypes.response, { httpCode: "200" }),
		];
		const edges: EdgeDTOSchemaType = [edge("1", "2"), edge("2", "3")];
		const { run, source } = compileGraph(blocks, edges, { inlineJs: false });
		expect(source).toContain("ctx.vm.runAsync");

		const ctx = createContext();
		expect((await run(ctx, 21)).output.body).toBe(42);
		expect(ctx.vars.shared).toBe(42);
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
				[block("1", BlockTypes.entrypoint), block("2", BlockTypes.sticky_note, {})],
				[edge("1", "2")],
			),
		).toThrow(/No codegen/);
	});
});

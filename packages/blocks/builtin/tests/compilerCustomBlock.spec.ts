import { describe, it, expect, afterEach } from "bun:test";
import { JsVM } from "@fluxify/lib";
import { compileGraph, instantiateCompiled } from "../../compiler";
import {
	customBlockNames,
	hasCustomBlock,
	registerCompiledCustomBlock,
	registerCustomBlock,
	unregisterCustomBlock,
} from "../customBlock";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType, EdgeDTOSchemaType } from "../../builderTypes";

const block = (id: string, type: string, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

const edge = (from: string, to: string, toHandle = "source") => ({
	id: `edge-${from}-${to}-${toHandle}`,
	from,
	to,
	fromHandle: "source",
	toHandle,
});

function createContext() {
	const vars: Record<string, any> = {};
	return {
		vm: new JsVM(vars),
		route: "/custom",
		apiId: "api-1",
		projectId: "proj-1",
		vars,
		stopper: { timeoutEnd: 0, duration: 10000 },
	} as any;
}

/**
 * Doubles a number and records that it ran. A custom block returns whatever its
 * last block produced, so one meant to return a value ends on that value rather
 * than on a response block.
 */
function registerDoubler(name = "double_it") {
	return registerCustomBlock(
		name,
		[
			block("c1", BlockTypes.entrypoint),
			block("c2", BlockTypes.jsrunner, {
				value: "calls = (typeof calls === 'number' ? calls : 0) + 1; return input.value * 2;",
			}),
		],
		[edge("c1", "c2")],
	);
}

afterEach(() => {
	for (const name of customBlockNames()) unregisterCustomBlock(name);
});

describe("compiled custom blocks", () => {
	it("registers into the worker library and compiles callers to an invoke", () => {
		expect(hasCustomBlock("double_it")).toBe(false);
		const source = registerDoubler();
		expect(hasCustomBlock("double_it")).toBe(true);
		expect(source).toContain("calls");

		const { source: callerSource } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", "double_it", { value: 21 }),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")],
		);

		// the custom block's own body is not inlined into the caller
		expect(callerSource).toContain('lib.invoke(ctx, "double_it"');
		expect(callerSource).not.toContain("calls");
	});

	it("sync invoke waits and takes the output", async () => {
		registerDoubler();
		const { run } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", "double_it", { value: "js:return input.n", invoke: "sync" }),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")],
		);

		const ctx = createContext();
		const result = await run(ctx, { n: 21 });

		expect(result.output.body).toBe(42);
		expect(ctx.vars.calls).toBe(1);
	});

	it("async invoke fires and moves on without taking the output", async () => {
		registerCustomBlock(
			"slow_side_effect",
			[
				block("c1", BlockTypes.entrypoint),
				block("c2", BlockTypes.jsrunner, {
					value:
						"await new Promise((r) => setTimeout(r, 5)); sideEffect = input.value; return sideEffect;",
				}),
			],
			[edge("c1", "c2")],
		);

		const { run, source } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", "slow_side_effect", { value: "written", invoke: "async" }),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")],
		);
		expect(source).toContain("lib.invokeAsync");

		const ctx = createContext();
		const result = await run(ctx, { keep: "me" });

		// the caller kept its own flowing value and did not wait
		expect(result.output.body).toEqual({ keep: "me" });
		expect(ctx.vars.sideEffect).toBeUndefined();

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(ctx.vars.sideEffect).toBe("written");
	});

	it("a failing async invoke does not reject into the caller", async () => {
		registerCustomBlock(
			"explodes",
			[
				block("c1", BlockTypes.entrypoint),
				block("c2", BlockTypes.jsrunner, { value: "throw new Error('boom');" }),
			],
			[edge("c1", "c2")],
		);

		const { run } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", "explodes", { invoke: "async" }),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")],
		);

		const result = await run(createContext(), "unharmed");
		expect(result.successful).toBe(true);
		expect(result.output.body).toBe("unharmed");
	});

	it("passes evaluated params plus the flowing value as input", async () => {
		registerCustomBlock(
			"echo_params",
			[
				block("c1", BlockTypes.entrypoint),
				block("c2", BlockTypes.jsrunner, { value: "return input;" }),
			],
			[edge("c1", "c2")],
		);

		const { run } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", "echo_params", {
					literal: "kept",
					computed: "js:return input.n + 1",
				}),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")],
		);

		const result = await run(createContext(), { n: 41 });
		expect(result.output.body).toEqual({
			literal: "kept",
			computed: 42,
			input: { n: 41 },
		});
	});

	it("resolves param: placeholders from the invocation, not the caller", async () => {
		// compiled once for the whole worker, so a placeholder cannot be baked in
		registerCustomBlock(
			"greet",
			[
				block("c1", BlockTypes.entrypoint),
				block("c2", BlockTypes.setvar, { key: "greeting", value: "param:salutation" }),
			],
			[edge("c1", "c2")],
		);

		const build = (salutation: string) =>
			compileGraph(
				[
					block("1", BlockTypes.entrypoint),
					block("2", "greet", { salutation }),
					block("3", BlockTypes.response, { httpCode: "200" }),
				],
				[edge("1", "2"), edge("2", "3")],
			);

		const first = createContext();
		const second = createContext();
		await build("hello").run(first, null);
		await build("hola").run(second, null);

		// two callers, one compiled block, no cross-talk
		expect(first.vars.greeting).toBe("hello");
		expect(second.vars.greeting).toBe("hola");
	});

	it("registers already-compiled source without running the compiler", async () => {
		// what a worker does: it receives JS from the artifact store, never a graph
		const source = registerDoubler("shipped");
		unregisterCustomBlock("shipped");
		expect(hasCustomBlock("shipped")).toBe(false);

		registerCompiledCustomBlock("shipped", source);
		expect(hasCustomBlock("shipped")).toBe(true);

		const { run } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", "shipped", { value: 4 }),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")],
		);
		expect((await run(createContext(), null)).output.body).toBe(8);
	});

	it("instantiates a compiled route from its source alone", async () => {
		const { source } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.jsrunner, { value: "return input * 3;" }),
				block("3", BlockTypes.response, { httpCode: "201" }),
			],
			[edge("1", "2"), edge("2", "3")],
		);

		const run = instantiateCompiled(source);
		const result = await run(createContext(), 14);

		expect(result.output).toEqual({ httpCode: "201", body: 42 });
	});

	it("compiling against an unknown block type still fails", () => {
		expect(() =>
			compileGraph(
				[block("1", BlockTypes.entrypoint), block("2", "never_registered")],
				[edge("1", "2")],
			),
		).toThrow(/No codegen for block type: never_registered/);
	});
});

describe("compiled cloud logs", () => {
	it("resolves the observability integration and logs the evaluated message", async () => {
		const logged: { level: string; message: any }[] = [];
		const target = {
			logInfo: (m: any) => logged.push({ level: "info", message: m }),
			logWarn: (m: any) => logged.push({ level: "warn", message: m }),
			logError: (m: any) => logged.push({ level: "error", message: m }),
		};
		const asked: any[] = [];

		const { run, source } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.cloudLogs, {
					connection: "obs-1",
					level: "error",
					message: "js:return { failed: input.id }",
				}),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")],
		);
		expect(source).not.toContain("ctx.vm");

		const ctx = createContext();
		ctx.integrationFactory = {
			create: (options: any) => {
				asked.push(options);
				return target;
			},
		};
		const result = await run(ctx, { id: 9 });

		expect(asked).toEqual([{ integrationId: "obs-1", type: "observability" }]);
		expect(logged).toEqual([{ level: "error", message: { failed: 9 } }]);
		// the block passes its input through untouched
		expect(result.output.body).toEqual({ id: 9 });
	});
});

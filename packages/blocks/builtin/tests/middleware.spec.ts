import { afterEach, describe, expect, it } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import { compileGraph } from "../../compiler";
import { runWithMiddlewares } from "../../middleware";
import { customBlockNames, registerCustomBlock, unregisterCustomBlock } from "../customBlock";
import { block, createContext, edge } from "./compilerTestHelpers";

/** a middleware custom block: entrypoint -> js -> optional response */
function register(name: string, js: string, httpCode?: string) {
	const blocks = [block("m1", BlockTypes.entrypoint), block("m2", BlockTypes.jsrunner, { value: js })];
	const edges = [edge("m1", "m2")];
	if (httpCode) {
		blocks.push(block("m3", BlockTypes.response, { httpCode }));
		edges.push(edge("m2", "m3"));
	}
	registerCustomBlock(name, blocks, edges);
}

/** the route: records its input and returns 201 with it */
const route = compileGraph(
	[
		block("r1", BlockTypes.entrypoint),
		block("r2", BlockTypes.jsrunner, { value: "routeRan = true; return input;" }),
		block("r3", BlockTypes.response, { httpCode: "201" }),
	],
	[edge("r1", "r2"), edge("r2", "r3")],
).run;

const step = (name: string) => ({ id: `mw-${name}`, name, blocks: [name] });

afterEach(() => {
	for (const name of customBlockNames()) unregisterCustomBlock(name);
});

describe("route middlewares", () => {
	it("getResponseBody/Status keep the reply after input is reshaped", async () => {
		register("drop", "return 'lost';");
		register("restore", "return { status: getResponseStatus(), body: getResponseBody(), input };");
		const ctx = createContext();
		ctx.vars.getResponseBody = () => null;
		ctx.vars.getResponseStatus = () => null;
		const result = await runWithMiddlewares(ctx, 7, route, {
			before: [],
			after: [step("drop"), step("restore")],
		});
		expect(result?.output).toEqual({
			httpCode: 200,
			body: { status: 201, body: 7, input: "lost" },
		});
	});

	it("chains before steps into the route and shares vars", async () => {
		register("add_one", "user = 'ann'; return input + 1;");
		register("times_two", "return input * 2;");
		const ctx = createContext();
		const result = await runWithMiddlewares(ctx, 1, route, {
			before: [step("add_one"), step("times_two")],
			after: [],
		});
		expect(result?.output).toEqual({ httpCode: "201", body: 4 });
		expect(ctx.vars.user).toBe("ann");
	});

	it("a before Response skips the route but still runs after", async () => {
		register("deny", "return 'nope';", "401");
		register("tag", "return { ...input, body: input.body + '!' };", "200");
		const ctx = createContext();
		const result = await runWithMiddlewares(ctx, 1, route, {
			before: [step("deny")],
			after: [step("tag")],
		});
		expect(ctx.vars.routeRan).toBeUndefined();
		expect(result?.output).toEqual({
			httpCode: "200",
			body: { httpCode: 401, body: "nope!" },
		});
	});

	it("after starts from { httpCode, body } and answers 200 without a Response", async () => {
		register("peek", "return input;");
		const result = await runWithMiddlewares(createContext(), "x", route, {
			before: [],
			after: [step("peek")],
		});
		expect(result?.output).toEqual({ httpCode: 200, body: { httpCode: 201, body: "x" } });
	});

	it("a failing step ends the request and skips the rest", async () => {
		register("boom", "throw new Error('bad');");
		register("never", "neverRan = true; return input;");
		const ctx = createContext();
		const result = await runWithMiddlewares(ctx, 1, route, {
			before: [step("boom")],
			after: [step("never")],
		});
		expect(result?.successful).toBe(false);
		expect(ctx.vars.routeRan).toBeUndefined();
		expect(ctx.vars.neverRan).toBeUndefined();
	});

	it("a step's own error handler can answer for it", async () => {
		registerCustomBlock(
			"guarded",
			[
				block("g1", BlockTypes.entrypoint),
				block("g2", BlockTypes.jsrunner, { value: "throw new Error('bad');" }),
				block("g3", BlockTypes.errorHandler),
				block("g4", BlockTypes.response, { httpCode: "403" }),
			],
			[edge("g1", "g2"), edge("g3", "g4")],
		);
		const result = await runWithMiddlewares(createContext(), 1, route, {
			before: [step("guarded")],
			after: [],
		});
		expect(result?.responded).toBe(true);
		expect(result?.output?.httpCode).toBe("403");
	});
});

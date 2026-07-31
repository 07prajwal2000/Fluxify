/**
 * Compiled-execution demo. Run it:
 *   bun run packages/blocks/compiler.demo.ts
 *
 * Builds a small graph, prints the JavaScript the compiler produced for it,
 * then runs that JavaScript against a real Context.
 */
import { JsVM } from "@fluxify/lib";
import { compileGraph } from "./compiler";
import { BlockTypes } from "./blockTypes";
import type { BlockDTOType, EdgeDTOSchemaType } from "./builderTypes";

const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

const edge = (from: string, to: string, toHandle = "source") => ({
	id: `edge-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle,
});

// entrypoint -> setvar(total) -> jsrunner(discount) -> setvar(final) -> getvar -> response
// plus an orphan block nobody connected: it must not appear in the output.
const blocks: BlockDTOType[] = [
	block("b1", BlockTypes.entrypoint),
	block("b2", BlockTypes.setvar, {
		key: "total",
		value: "js:return input.items.reduce((sum, i) => sum + i.price * i.qty, 0)",
	}),
	block("b3", BlockTypes.jsrunner, {
		value: "return input > 100 ? input * 0.9 : input;",
	}),
	block("b4", BlockTypes.setvar, { key: "final", value: "js:return Math.round(input)" }),
	block("b5", BlockTypes.getvar, { key: "final" }),
	block("b6", BlockTypes.response, { httpCode: "200" }),
	block("orphan", BlockTypes.setvar, { key: "never", value: "unreachable" }),
];

const edges: EdgeDTOSchemaType = [
	edge("b1", "b2"),
	edge("b2", "b3"),
	edge("b3", "b4"),
	edge("b4", "b5"),
	edge("b5", "b6"),
];

const { source, run } = compileGraph(blocks, edges);

console.log("--- compiled source ---");
console.log(source);
console.log("--- unreachable block compiled?", source.includes("never"), "---\n");

const vars: Record<string, any> = {};
const ctx = {
	vm: new JsVM(vars),
	route: "/checkout",
	apiId: "api-1",
	projectId: "proj-1",
	vars,
	stopper: { timeoutEnd: 0, duration: 10_000 },
} as any;

const requestBody = {
	items: [
		{ price: 40, qty: 2 },
		{ price: 15, qty: 3 },
	],
};

run(ctx, requestBody).then((result) => {
	console.log("vars   :", vars);
	console.log("result :", JSON.stringify(result));

	// 125 total -> over 100 so 10% off -> 112.5 -> rounded 113
	if (result.output.body !== 113)
		throw new Error(`expected 113, got ${result.output.body}`);
	if (vars.never !== undefined) throw new Error("orphan block ran");
	console.log("\nok");
});

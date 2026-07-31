/**
 * Interpreted DAG (built per request, like blocksLoader does) vs compiled JS.
 *   bun run packages/blocks/compiler.bench.ts
 *
 * Three graphs, all built out of blocks a user could actually draw:
 *   1. bubble sort   — nested for loops, if, js runner. JS-heavy.
 *   2. filter pairs  — foreach over the request body, multi-condition if, array push.
 *   3. hot counter   — for loop over a setvar with a literal. No JS at all.
 *
 * Both sides run the same graph against the same seeded dataset and their
 * outputs are compared before anything is timed.
 */
import { JsVM } from "@fluxify/lib";
import { BlockBuilder } from "./builder";
import { BlockTypes } from "./blockTypes";
import { Engine } from "./engine";
import { compileGraph } from "./compiler";
import type { BlockDTOType, EdgeDTOSchemaType } from "./builderTypes";

// --- fixtures ---------------------------------------------------------------

/** mulberry32 — same dataset on every run */
function seeded(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randomNumbers(count: number, seed = 42) {
	const random = seeded(seed);
	return Array.from({ length: count }, () => Math.floor(random() * 1000));
}

const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
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

const condition = (lhs: any, operator: string, rhs: any, chain = "and") => ({
	lhs,
	rhs,
	operator,
	chain,
});

function createContext() {
	const vars: Record<string, any> = {};
	const vm = new JsVM(vars);
	// count sandbox entries — both sides run the same user JS, so this is the
	// floor neither implementation can get under while the VM is in the path
	const counted = { calls: 0 };
	const run = vm.run.bind(vm);
	const runAsync = vm.runAsync.bind(vm);
	vm.run = (...args: Parameters<typeof run>) => (counted.calls++, run(...args));
	vm.runAsync = (...args: Parameters<typeof runAsync>) => (
		counted.calls++, runAsync(...args)
	);
	return {
		vm,
		counted,
		route: "/bench",
		apiId: "api-1",
		projectId: "proj-1",
		vars,
		stopper: { timeoutEnd: 0, duration: 60_000 },
	} as any;
}

// --- graphs -----------------------------------------------------------------

type Case = {
	name: string;
	blocks: BlockDTOType[];
	edges: EdgeDTOSchemaType;
	input: any;
	reps: number;
};

const SORT_SIZE = 40;
const FILTER_SIZE = 300;
const COUNTER_SIZE = 5000;

/** bubble sort: for i { for j { if arr[j] > arr[j+1] -> swap } } */
const bubbleSort: Case = {
	name: `bubble sort (${SORT_SIZE} numbers, ${(SORT_SIZE - 1) ** 2} inner iterations)`,
	input: randomNumbers(SORT_SIZE),
	reps: 10,
	blocks: [
		block("s1", BlockTypes.entrypoint),
		block("s2", BlockTypes.setvar, { key: "arr", value: "js:return input.slice()" }),
		block("s3", BlockTypes.forloop, { start: 0, end: SORT_SIZE - 1, step: 1 }),
		block("s4", BlockTypes.forloop, { start: 0, end: SORT_SIZE - 1, step: 1 }),
		block("s5", BlockTypes.if, {
			conditions: [
				condition("js:return arr[input]", "gt", "js:return arr[input + 1]"),
			],
		}),
		block("s6", BlockTypes.jsrunner, {
			value:
				"const t = arr[input]; arr[input] = arr[input + 1]; arr[input + 1] = t; return input;",
		}),
		block("s7", BlockTypes.getvar, { key: "arr" }),
		block("s8", BlockTypes.response, { httpCode: "200" }),
	],
	edges: [
		edge("s1", "s2"),
		edge("s2", "s3"),
		edge("s3", "s4", "executor"),
		edge("s4", "s5", "executor"),
		edge("s5", "s6", "success"),
		edge("s3", "s7"),
		edge("s7", "s8"),
	],
};

/** keep every value that is both divisible by 3 and above 500 */
const filterPairs: Case = {
	name: `filter (${FILTER_SIZE} numbers, foreach + 2-condition if + array push)`,
	input: randomNumbers(FILTER_SIZE, 7),
	reps: 30,
	blocks: [
		block("f1", BlockTypes.entrypoint),
		// foreach reads its array from the flowing value, so pass the numbers on
		block("f2", BlockTypes.jsrunner, { value: "matches = []; return input;" }),
		block("f3", BlockTypes.foreachloop, { values: [], useParam: true }),
		block("f4", BlockTypes.if, {
			conditions: [
				condition("js:return input % 3", "eq", 0),
				condition("js:return input", "gt", 500),
			],
		}),
		block("f5", BlockTypes.arrayops, {
			operation: "push",
			datasource: "matches",
			useParamAsInput: true,
		}),
		block("f6", BlockTypes.getvar, { key: "matches" }),
		block("f7", BlockTypes.response, { httpCode: "200" }),
	],
	edges: [
		edge("f1", "f2"),
		edge("f2", "f3"),
		edge("f3", "f4", "executor"),
		edge("f4", "f5", "success"),
		edge("f3", "f6"),
		edge("f6", "f7"),
	],
};

/** pure block plumbing — no sandbox calls at all, so this is the ceiling */
const hotCounter: Case = {
	name: `hot counter (${COUNTER_SIZE} iterations, no JS anywhere)`,
	input: null,
	reps: 10,
	blocks: [
		block("c1", BlockTypes.entrypoint),
		block("c2", BlockTypes.forloop, { start: 0, end: COUNTER_SIZE, step: 1 }),
		block("c3", BlockTypes.setvar, { key: "last", value: 1 }),
		block("c4", BlockTypes.getvar, { key: "last" }),
		block("c5", BlockTypes.response, { httpCode: "200" }),
	],
	edges: [
		edge("c1", "c2"),
		edge("c2", "c3", "executor"),
		edge("c2", "c4"),
		edge("c4", "c5"),
	],
};

// --- runners ----------------------------------------------------------------

/** exactly what blocksLoader does today: rebuild the whole graph per request */
async function runInterpreted(testCase: Case, context = createContext()) {
	const builder = new BlockBuilder(
		context,
		{
			create(builder, executor) {
				return new Engine(builder.buildGraph(executor), {
					errorHandlerId: builder.getErrorHandlerId(),
					context,
				});
			},
		},
		{ create: () => ({}) as any },
	);
	builder.loadBlocks(testCase.blocks);
	builder.loadEdges(testCase.edges);
	const entrypoint = builder.getEntrypoint();
	const engine = new Engine(builder.buildGraph(entrypoint), {
		errorHandlerId: builder.getErrorHandlerId(),
		context,
	});
	return engine.start(entrypoint, testCase.input);
}

async function time(reps: number, fn: () => Promise<any>) {
	await fn(); // warm up the JIT so neither side pays first-call cost
	const started = performance.now();
	for (let i = 0; i < reps; i++) await fn();
	return (performance.now() - started) / reps;
}

async function bench(testCase: Case) {
	const compileStarted = performance.now();
	const inlined = compileGraph(testCase.blocks, testCase.edges);
	const compileMs = performance.now() - compileStarted;
	const sandboxed = compileGraph(testCase.blocks, testCase.edges, {
		inlineJs: false,
	});

	const interpretedCtx = createContext();
	const sandboxedCtx = createContext();
	const inlinedCtx = createContext();
	const outputs = [
		(await runInterpreted(testCase, interpretedCtx))?.output,
		(await sandboxed.run(sandboxedCtx, testCase.input))?.output,
		(await inlined.run(inlinedCtx, testCase.input))?.output,
	].map((output) => JSON.stringify(output));
	const same = outputs.every((output) => output === outputs[0]);

	const interpretedMs = await time(testCase.reps, () => runInterpreted(testCase));
	const sandboxedMs = await time(testCase.reps, () =>
		sandboxed.run(createContext(), testCase.input),
	);
	const inlinedMs = await time(testCase.reps, () =>
		inlined.run(createContext(), testCase.input),
	);

	console.log(`\n${testCase.name}`);
	console.log(`  outputs match      : ${same ? "yes" : "NO — results differ!"}`);
	if (!same) outputs.forEach((o) => console.log(`    ${o?.slice(0, 110)}`));
	console.log(`  interpreted        : ${interpretedMs.toFixed(3)} ms/request`);
	console.log(
		`  compiled (vm)      : ${sandboxedMs.toFixed(3)} ms/request   ${(interpretedMs / sandboxedMs).toFixed(2)}x`,
	);
	console.log(
		`  compiled (inlined) : ${inlinedMs.toFixed(3)} ms/request   ${(interpretedMs / inlinedMs).toFixed(2)}x`,
	);
	console.log(
		`  compile once       : ${compileMs.toFixed(3)} ms  (${inlined.source.split("\n").length} lines of JS)`,
	);
	console.log(
		`  sandbox calls      : ${interpretedCtx.counted.calls} interpreted / ${sandboxedCtx.counted.calls} compiled-vm / ${inlinedCtx.counted.calls} inlined`,
	);
}

async function main() {
	for (const testCase of [bubbleSort, filterPairs, hotCounter]) {
		await bench(testCase);
	}
}

main();

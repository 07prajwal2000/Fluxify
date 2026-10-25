import { afterEach, describe, expect, it } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType } from "../../builderTypes";
import { compileGraph } from "../../compiler";
import { compileSchema } from "../../schema/schemaCache";
import {
	type BlockMeta,
	customBlockNames,
	type ModuleBlockRun,
	registerModuleBlock,
	unregisterBlock,
} from "../customBlock";

const PROJECT = "proj-r7";
const TYPE = "acme/demo/validate";
const userSchema = {
	dataType: "object",
	properties: [{ key: "name", dataType: "str", required: true }],
};


const block = (id: string, type: string, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string) => ({
	id: `e-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: `${from}-source`,
});
const ctx = () =>
	({
		route: "/r7",
		apiId: "api-1",
		projectId: PROJECT,
		vars: { shape: userSchema },
		stopper: { timeoutEnd: 0, duration: 10000 },
	}) as any;

/** entry -> step(data) -> response; what the step's `run` saw is returned */
function run(data: Record<string, unknown>, meta: Partial<BlockMeta>, input: unknown = {}) {
	let seen: Record<string, any> = {};
	const body: ModuleBlockRun = ({ params }) => {
		seen = params;
		return { output: "ok" };
	};
	const blockMeta = { handles: { in: ["target"], out: ["source"], body: [] }, ...meta };
	registerModuleBlock(PROJECT, TYPE, body, blockMeta);
	const { run: exec, source } = compileGraph(
		[
			block("1", BlockTypes.entrypoint),
			block("2", TYPE, data),
			block("3", BlockTypes.response, { httpCode: "200" }),
		],
		[edge("1", "2"), edge("2", "3")],
		{ projectId: PROJECT, blockMeta: { [TYPE]: blockMeta } },
	);
	return { exec: () => exec(ctx(), input), seen: () => seen, source };
}

afterEach(() => {
	for (const name of customBlockNames(PROJECT)) unregisterBlock(PROJECT, name);
});

describe("module block schema params", () => {
	it("hands run { zod, schema } for a stored definition, compiled at instantiation", async () => {
		const { exec, seen, source } = run({ shape: userSchema, note: "x" }, { schemaParams: ["shape"] });
		expect(source).toContain("lib.compileSchema(");
		// hoisted above the block functions, not inside a request
		expect(source.indexOf("lib.compileSchema(")).toBeLessThan(source.indexOf("function $block_0"));
		await exec();
		const { zod, schema } = seen().shape;
		expect(schema).toEqual(userSchema);
		expect(zod).toBe(compileSchema(userSchema).zod);
		expect(zod.safeParse({ name: "a" }).success).toBe(true);
		expect(zod.safeParse({ name: 1 }).success).toBe(false);
		expect(seen().note).toBe("x");
	});

	it("compiles a js: schema per request through the cache", async () => {
		const { exec, seen, source } = run(
			{ shape: "js:return shape" },
			{ schemaParams: ["shape"] },
		);
		expect(source).not.toMatch(/const \$h_\d+ = lib\.compileSchema/);
		await exec();
		expect(seen().shape.zod).toBe(compileSchema(userSchema).zod);
	});

	it("an async call converts in the wrapper, so a queued payload can stay JSON", async () => {
		const { exec, seen, source } = run(
			{ shape: userSchema, invoke: "async" },
			{ schemaParams: ["shape"], invoke: ["sync", "async"] },
		);
		expect(source).toContain(JSON.stringify(userSchema));
		await exec();
		await new Promise((r) => setTimeout(r, 10));
		expect(seen().shape.zod.safeParse({ name: "a" }).success).toBe(true);
	});

	it("fails the compile, naming the block, for an invalid definition", () => {
		expect(() => run({ shape: { dataType: "nope" } }, { schemaParams: ["shape"] })).toThrow(
			"Block 2",
		);
	});

	it("leaves params alone when the block declares no schema params", async () => {
		const { exec, seen } = run({ shape: userSchema }, {});
		await exec();
		expect(seen().shape).toEqual(userSchema);
	});
});

describe("module block fieldMap params", () => {
	const map = { id: "userId", email: "email", missing: "gone" };
	const input = { id: 7, email: "a@b.c", other: 1 };

	/** entry -> transformer(map) -> response, the reference a fieldMap param must match */
	const transformed = async () => {
		const { run: exec } = compileGraph(
			[
				block("1", BlockTypes.entrypoint),
				block("2", BlockTypes.transformer, { fieldMap: map, useJs: false }),
				block("3", BlockTypes.response, { httpCode: "200" }),
			],
			[edge("1", "2"), edge("2", "3")],
			{ projectId: PROJECT },
		);
		return ((await exec(ctx(), input)) as any).output.body;
	};

	it("hands run what a Transformer makes of the input with the same map", async () => {
		const { exec, seen } = run({ shape: map }, { fieldMapParams: ["shape"] }, input);
		await exec();
		expect(seen().shape).toEqual(await transformed());
		expect(seen().shape).toEqual({ userId: 7, email: "a@b.c", gone: undefined });
	});

	it("maps on an async call too, before the block is fired", async () => {
		const { exec, seen } = run(
			{ shape: map, invoke: "async" },
			{ fieldMapParams: ["shape"], invoke: ["sync", "async"] },
			input,
		);
		await exec();
		await new Promise((r) => setTimeout(r, 10));
		expect(seen().shape).toEqual(await transformed());
	});
});

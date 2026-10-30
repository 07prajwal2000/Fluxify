import { afterEach, describe, expect, it } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType } from "../../builderTypes";
import { compileGraph } from "../../compiler";
import {
	customBlockNames,
	getBlockEntry,
	invokeCustomBlock,
	registerBlock,
	registerModuleBlock,
	unregisterBlock,
	unregisterById,
} from "../customBlock";

const PROJECT = "proj-r1";
const ECHO = "acme/demo/echo";

const block = (id: string, type: string, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});
const edge = (from: string, to: string) => ({
	id: `edge-${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: "source",
});
const ctx = () =>
	({
		route: "/r1",
		apiId: "api-1",
		projectId: PROJECT,
		vars: {},
	}) as any;
const noop = async () => ({ successful: true, continueIfFail: false });

const routeCalling = (type: string, invoke: string) =>
	compileGraph(
		[
			block("1", BlockTypes.entrypoint),
			block("2", type, { greeting: "hi", invoke }),
			block("3", BlockTypes.response, { httpCode: "200" }),
		],
		[edge("1", "2"), edge("2", "3")],
		{ projectId: PROJECT },
	);

afterEach(() => {
	for (const name of customBlockNames(PROJECT)) unregisterBlock(PROJECT, name);
});

describe("block library", () => {
	it("registers, unregisters, and replaces the old type on a rename by id", () => {
		registerBlock(PROJECT, "a", { run: noop, id: "id-1", source: "canvas" });
		expect(getBlockEntry(PROJECT, "a")?.id).toBe("id-1");

		registerBlock(PROJECT, "b", { run: noop, id: "id-1", source: "canvas" });
		expect(customBlockNames(PROJECT)).toEqual(["b"]);

		unregisterById("id-1");
		expect(customBlockNames(PROJECT)).toEqual([]);

		registerBlock(PROJECT, "c", { run: noop, source: "canvas" });
		unregisterBlock(PROJECT, "c");
		expect(getBlockEntry(PROJECT, "c")).toBeUndefined();
	});

	it("a module block's return becomes the output, and keeps its handle", async () => {
		registerModuleBlock(PROJECT, ECHO, ({ params, input }) => ({
			output: { params, input },
			handle: "success",
		}));
		const entry = getBlockEntry(PROJECT, ECHO)!;
		expect(entry.source).toBe("module");
		const result = await entry.run(ctx(), { params: { a: 1 }, input: 2 });
		expect(result).toMatchObject({
			successful: true,
			handle: "success",
			output: { params: { a: 1 }, input: 2 },
		});
	});

	it("a module block's throw becomes a failure, rethrown by a sync invoke", async () => {
		registerModuleBlock(PROJECT, ECHO, () => {
			throw new Error("boom");
		});
		const result = await getBlockEntry(PROJECT, ECHO)!.run(ctx(), { params: {} });
		expect(result).toMatchObject({ successful: false, continueIfFail: false });
		expect(invokeCustomBlock(ctx(), ECHO, { params: {} })).rejects.toThrow("boom");
	});
});

describe("namespaced module block in a route", () => {
	it("compiles and runs in sync mode", async () => {
		registerModuleBlock(PROJECT, ECHO, ({ params }) => ({ output: `${params.greeting}!` }));
		const { run, source } = routeCalling(ECHO, "sync");
		expect(source).toContain(`lib.invoke(ctx, "${ECHO}"`);
		const result = await run(ctx(), {});
		expect(result.output.body).toBe("hi!");
	});

	it("reports an async failure instead of throwing", async () => {
		registerModuleBlock(PROJECT, ECHO, async () => {
			throw new Error("async boom");
		});
		// the logger is a Proxy, so the failure is observed on the block's trace scope
		const closed: unknown[] = [];
		const context = ctx();
		context.trace = {
			enterCustomBlock: () => ({
				trace: context.trace,
				close: (...args: unknown[]) => closed.push(args),
			}),
		};
		const result = await routeCalling(ECHO, "async").run(context, {});
		expect(result.successful).toBe(true);
		await new Promise((r) => setTimeout(r, 5));
		expect(closed).toEqual([["failure", expect.any(Error)]]);
	});
});

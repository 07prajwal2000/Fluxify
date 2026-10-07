import { describe, expect, it } from "bun:test";
import { loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/**
 * Execution recording (#254), through the real recorder. Recording is its own
 * switch: with tracing off it still compiles span code and starts a recorder,
 * and every span says which canvas it belongs to, two custom blocks deep.
 */

const nested = await loadGraph("recordings/nested");
const request = { body: { n: 3 } };

describe("execution recording", () => {
	it("records a run with tracing off", async () => {
		const run = await runGraph(nested, request, { tracingEnabled: false, recordExecution: true });

		expect(run.status).toBe(200);
		expect(run.body).toBe(12);
		expect(run.recorded).toHaveLength(1);
		const [recorded] = run.recorded;
		expect(recorded!.routeId).toBe("recordings/nested-route");
		expect(recorded!.outcome).toBe("success");
		expect(recorded!.statusCode).toBe(200);
		// the route's own blocks report: their span code was compiled in
		expect(recorded!.spans.map((span) => span.blockId)).toEqual(
			expect.arrayContaining(["entry", "num", "outer"]),
		);
	});

	it("tags every nested span with the custom block whose graph it ran in", async () => {
		const run = await runGraph(nested, request, { tracingEnabled: false, recordExecution: true });
		const spans = run.recorded[0]!.spans;
		const byBlock = Object.fromEntries(spans.map((span) => [span.blockId, span]));

		for (const id of ["entry", "num", "outer"]) expect(byBlock[id]!.customBlockId).toBeUndefined();
		for (const id of ["rq-entry", "rq-call", "rq-done"]) {
			expect(byBlock[id]!.customBlockId).toBe("rec-quadruple");
			expect(byBlock[id]!.parentSeq).toBe(byBlock.outer!.seq);
		}
		// the inner block's spans name the inner block, not the outer one
		for (const id of ["rd-entry", "rd-double"]) {
			expect(byBlock[id]!.customBlockId).toBe("rec-double");
			expect(byBlock[id]!.parentSeq).toBe(byBlock["rq-call"]!.seq);
		}
		expect(byBlock["rd-double"]!.output).toBe(6);
	});

	it("starts no recorder with both switches off", async () => {
		const run = await runGraph(nested, request, { tracingEnabled: false, recordExecution: false });

		expect(run.body).toBe(12);
		expect(run.recorded).toEqual([]);
		// no span code in the route itself; custom blocks always carry theirs
		expect(run.executed).not.toContain("num");
	});
});

describe("entrypoint input and block positions (#628)", () => {
	const withRequest = {
		...request,
		method: "POST",
		headers: { authorization: "Bearer e2e", cookie: "sid=s1", "x-trace": "t" },
		query: { page: "2", tag: ["a", "b"] },
		params: { id: "7" },
	};

	it("records the whole request on the route's entrypoint", async () => {
		const run = await runGraph(nested, withRequest, { tracingEnabled: false, recordExecution: true });
		const spans = run.recorded[0]!.spans;
		const entry = spans.find((span) => span.blockId === "entry")!;

		expect(entry.input).toMatchObject({
			method: "POST",
			path: nested.route.path,
			host: "e2e",
			query: { page: "2", tag: ["a", "b"] },
			params: { id: "7" },
			headers: { authorization: "Bearer e2e", "x-trace": "t" },
			cookies: { sid: "s1" },
			body: { n: 3 },
		});
		expect((entry.input as { url: string }).url).toContain(`http://e2e${nested.route.path}`);
		// a custom block's own entrypoint keeps its call input, not the request
		const inner = spans.find((span) => span.blockId === "rq-entry")!;
		expect(inner.input).not.toHaveProperty("headers");
	});

	it("bakes every span's canvas position into its metadata, at every depth", async () => {
		const run = await runGraph(nested, request, { tracingEnabled: false, recordExecution: true });
		const fixtures = [nested, ...(await Promise.all(["rec-double", "rec-quadruple"].map(readBlock)))];
		const positions = Object.fromEntries(
			fixtures.flatMap((graph) => graph.blocks.map((block) => [block.id, block.position])),
		);
		const spans = run.recorded[0]!.spans;
		expect(spans.length).toBeGreaterThan(4);
		for (const span of spans) expect(span.metadata?.position).toEqual(positions[span.blockId]);
	});
});

async function readBlock(name: string): Promise<{ blocks: { id: string; position: unknown }[] }> {
	return Bun.file(new URL(`../blocks/${name}.json`, import.meta.url)).json();
}

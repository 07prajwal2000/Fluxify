import { describe, expect, it } from "bun:test";
import { type Engine, resetDatabase } from "../src/engines";
import { type GraphFixture, loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/** #571: the integration's Max connections sizes its pool */
const twoAtOnce = await loadGraph("pool/two-at-once");

/** two half-second queries at the same time, on each engine */
const BOTH: Record<Exclude<Engine, "none" | "pg">, string> = {
	mysql: 'await Promise.all([dbQuery("SELECT SLEEP(0.5)"), dbQuery("SELECT SLEEP(0.5)")]);\nreturn { done: 2 };',
	// limit 1: $where runs once, on the first document
	mongo:
		'const db = await dbQuery();\nconst slow = () => db.collection("todos").find({ $where: "sleep(500) || true" }).limit(1).toArray();\nawait Promise.all([slow(), slow()]);\nreturn { done: 2 };',
};

function fixture(engine: Exclude<Engine, "none">, maxConnections?: number): GraphFixture {
	if (engine === "pg") return { ...twoAtOnce, maxConnections };
	const blocks = twoAtOnce.blocks.map((b) =>
		b.id === "two" ? { ...b, data: { ...(b.data as object), js: BOTH[engine] } } : b,
	) as GraphFixture["blocks"];
	return { ...twoAtOnce, engine, maxConnections, blocks };
}

async function timed(f: GraphFixture) {
	const started = Date.now();
	const run = await runGraph(f);
	return { status: run.status, body: run.body, ms: Date.now() - started };
}

describe("pool size", () => {
	for (const engine of ["pg", "mysql", "mongo"] as const) {
		it(`runs queries side by side by default, and one at a time with a pool of 1 on ${engine}`, async () => {
			await resetDatabase(engine);

			const roomy = await timed(fixture(engine));
			expect(roomy).toMatchObject({ status: 200, body: { done: 2 } });
			expect(roomy.ms).toBeLessThan(900);

			// a new size is a changed integration: the next request gets a new pool
			const single = await timed(fixture(engine, 1));
			expect(single).toMatchObject({ status: 200, body: { done: 2 } });
			expect(single.ms).toBeGreaterThanOrEqual(1000);
		});
	}
});

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDatabase } from "../src/engines";
import { loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/**
 * #408: a read's SQL is built once per shape and saved with the pool. One graph, run again
 * and again on the same pool: a request whose SQL would be the same reuses the saved SQL with
 * its own values, and one whose SQL would differ (a null, a skipped condition, a JSON path
 * compared to a number) gets its own. Every answer must still be the right rows.
 */
const people = await loadGraph("conditions/people");

const names = (run: { body: unknown }) =>
	(run.body as { name: string }[]).map((row) => row.name).sort();

const runs: [Record<string, unknown>, string[]][] = [
	[{ column: "name", value: "Ada Lovelace" }, ["Ada Lovelace"]],
	[{ column: "name", value: "Grace Hopper" }, ["Grace Hopper"]],
	[{ column: "nickname", value: null }, ["Ghost", "Grace Hopper"]],
	[{ column: "nickname", value: "pct" }, ["100% Real_Name\\"]],
	[{ column: "profile.score", value: 7 }, ["100% Real_Name\\", "C++ (dev) [x].*"]],
	[{ column: "profile.score", value: "10" }, ["Ada Lovelace"]],
	[{ column: "name" }, ["100% Real_Name\\", "Ada Lovelace", "C++ (dev) [x].*", "Ghost", "Grace Hopper"]],
	[{ column: "name", value: "Ghost" }, ["Ghost"]],
];

for (const engine of ["pg", "mysql"] as const) {
	describe(`saved read SQL on ${engine}`, () => {
		beforeEach(() => resetDatabase(engine));

		it("answers each request with its own values, whether its SQL was saved or not", async () => {
			for (const [body, expected] of runs) {
				const run = await runGraph({ ...people, engine }, { body });
				expect({ body, status: run.status, names: names(run) }).toEqual({
					body,
					status: 200,
					names: expected,
				});
			}
		});
	});
}

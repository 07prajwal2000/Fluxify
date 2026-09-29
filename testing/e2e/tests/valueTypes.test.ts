import { beforeEach, describe, expect, it } from "bun:test";
import { resetDatabase } from "../src/engines";
import { loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/** #512: bigint, decimal and date columns reach the flow as the same JS types on every engine */
const read = await loadGraph("value-types/read");

// seed: amounts row small 42, big 9007199254740993, price 12.50, at 2024-01-02 03:04:05 UTC
for (const engine of ["pg", "mysql", "mongo"] as const) {
	describe(`value types on ${engine}`, () => {
		beforeEach(() => resetDatabase(engine));

		it("gives a safe bigint as a number, a big one and a decimal as text, a time as a UTC Date", async () => {
			const run = await runGraph({ ...read, engine });

			expect(run.status).toBe(200);
			expect(run.body).toEqual({
				plusOne: 43,
				big: "9007199254740993",
				price: "12.50",
				priceNumber: 13.5,
				isDate: true,
				at: "2024-01-02T03:04:05.000Z",
			});
		});
	});
}

import { describe, expect, it } from "bun:test";
import { loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/** #544: Set and Get blocks in Multiple mode output one value per row, in row order */
const chain = await loadGraph("multi-mode/chain");

describe("Multiple mode", () => {
	it("runs every row in order and outputs an array of values", async () => {
		const run = await runGraph(chain, {
			path: "/multi/7",
			params: { id: "7" },
			query: { q: "hi" },
			headers: { "x-req": "yes", cookie: "c1=v1" },
		});

		expect(run.status).toBe(200);
		expect(run.body).toEqual({
			// a later row reads the variable an earlier row set
			setOut: [1, 2],
			// Set Header passes its input through
			headerPass: [1, 2],
			getVarOut: [1, 2],
			// a missing value is "" as in Single mode, and does not fail the other rows
			headersOut: ["yes", ""],
			cookiesOut: ["v1", ""],
			paramsOut: ["hi", "7"],
		});
	});

	it("lets a later header row replace an earlier one with the same name", async () => {
		const run = await runGraph(chain, { path: "/multi/7", params: { id: "7" } });

		expect(run.headers.get("x-one")).toBe("again");
		expect(run.headers.get("x-two")).toBe("two");
	});
});

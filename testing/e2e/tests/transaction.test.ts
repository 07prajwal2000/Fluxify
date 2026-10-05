import { beforeEach, describe, expect, it } from "bun:test";
import { resetDatabase } from "../src/engines";
import { loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

const input = await loadGraph("transaction/input");

beforeEach(() => resetDatabase("pg"));

describe("transaction/input", () => {
	it("passes the Transaction block's input to the first executor block", async () => {
		const run = await runGraph(input, { body: { user_id: 2, total: 50 } });

		expect(run.status).toBe(201);
		expect(run.body).toMatchObject({ user_id: 2, total: "50.00", status: "pending" });
	});
});

import { beforeEach, describe, expect, it } from "bun:test";
import { loadGraph } from "../src/graph";
import { database } from "../src/postgres";
import { resetDatabase } from "../src/engines";
import { runGraph } from "../src/runner";

const fixture = await loadGraph("get-users");

beforeEach(() => resetDatabase("pg"));

describe("get-users", () => {
	it("returns the seeded users", async () => {
		const run = await runGraph(fixture);

		expect(run.status).toBe(200);
		expect(run.body).toEqual([
			{ id: 1, name: "Ada Lovelace", email: "ada@example.com" },
			{ id: 2, name: "Grace Hopper", email: "grace@example.com" },
			{ id: 3, name: "Alan Turing", email: "alan@example.com" },
		]);
	});

	it("runs every block in the graph", async () => {
		// the response alone cannot tell a working graph from one whose read was
		// skipped by a dead branch — assert on what actually executed
		const run = await runGraph(fixture);
		expect(run.executed).toEqual(["entry", "fetch-users", "reply"]);
		expect(run.spans.every((span) => span.outcome === "success")).toBe(true);
	});

	it("selects only the columns the graph asked for", async () => {
		const run = await runGraph(fixture);
		expect(Object.keys(run.body[0])).toEqual(["id", "name", "email"]);
	});

	it("returns an empty list rather than failing on an empty table", async () => {
		const { sql } = await database();
		await sql`DELETE FROM orders`;
		await sql`DELETE FROM users`;

		const run = await runGraph(fixture);
		expect(run.status).toBe(200);
		expect(run.body).toEqual([]);
	});
});

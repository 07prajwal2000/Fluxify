import { beforeEach, describe, expect, it } from "bun:test";
import { ObjectId } from "mongodb";
import { type GraphFixture, loadGraph } from "../src/graph";
import { mongo } from "../src/mongo";
import { runGraph } from "../src/runner";

/**
 * #511: MongoDB ids. A reference field holding ObjectIds matches the hex string
 * a graph passes, inserts store it as an ObjectId, a bad id fails loudly, and a
 * collection with its own `id` field is filtered and sorted on that field.
 * Collections are filled here: `rides` refers to riders by ObjectId, `legacy`
 * has numeric `id`s of its own.
 */
const people = await loadGraph("conditions/people");
const single = await loadGraph("upsert/single");

const RIDER = new ObjectId();

/** a block's data patched, on Mongo */
function on(fixture: GraphFixture, blockId: string, patch: Record<string, unknown>): GraphFixture {
	return {
		...fixture,
		engine: "mongo",
		blocks: fixture.blocks.map((b) =>
			b.id === blockId ? { ...b, data: { ...(b.data as object), ...patch } } : b,
		) as GraphFixture["blocks"],
	};
}

const find = (table: string, column: string, value: unknown) =>
	runGraph(on(people, "find", { tableName: table, columns: ["*"] }), { body: { column, value } });

const insertRide = (row: Record<string, unknown>) =>
	runGraph(on(single, "upsert", { tableName: "rides", onConflict: undefined }), { body: { row } });

describe("MongoDB ids", () => {
	beforeEach(async () => {
		const { db } = await mongo();
		await db.collection("rides").deleteMany({});
		await db.collection("rides").insertMany([
			{ riderId: RIDER, status: "done" },
			{ riderId: new ObjectId(), status: "open" },
		]);
		await db.collection("legacy").deleteMany({});
		await db.collection("legacy").insertMany([
			{ id: 2, name: "two" },
			{ id: 1, name: "one" },
		]);
	});

	it("finds by an ObjectId reference field given its hex string", async () => {
		const run = await find("rides", "riderId", RIDER.toHexString());

		expect(run.status).toBe(200);
		expect(run.body).toMatchObject([{ riderId: RIDER.toHexString(), status: "done" }]);
	});

	it("still finds by id", async () => {
		const { db } = await mongo();
		const ride = await db.collection("rides").findOne({ status: "open" });
		const run = await find("rides", "id", ride!._id.toHexString());

		expect(run.body).toMatchObject([{ id: ride!._id.toHexString(), status: "open" }]);
	});

	it("stores a hex string as an ObjectId on a field that holds them", async () => {
		const run = await insertRide({ riderId: RIDER.toHexString(), status: "new" });

		expect(run.status).toBe(200);
		const stored = await (await mongo()).db.collection("rides").findOne({ status: "new" });
		expect(stored!.riderId).toBeInstanceOf(ObjectId);
		expect(stored!.riderId.equals(RIDER)).toBe(true);
	});

	it("fails on a value that can't be an ObjectId instead of matching nothing", async () => {
		const read = await find("rides", "riderId", "not-an-id");
		const write = await insertRide({ riderId: "r-1", status: "bad" });

		for (const [run, blockId] of [
			[read, "find"],
			[write, "upsert"],
		] as const) {
			expect(run.status).toBeGreaterThanOrEqual(400);
			const error = run.spans.find((s) => s.blockId === blockId)!.error as Error;
			expect(String((error.cause as Error)?.message ?? error.message)).toContain(
				"holds ObjectIds",
			);
		}
		expect(await (await mongo()).db.collection("rides").countDocuments({ status: "bad" })).toBe(0);
	});

	it("filters and sorts on a collection's own id field", async () => {
		const run = await find("legacy", "id", 2);

		expect(run.status).toBe(200);
		expect(run.body).toMatchObject([{ id: 2, name: "two" }]);
		expect(typeof (run.body as { _id: unknown }[])[0]._id).toBe("string");

		// the graph sorts by id: the real field, not insertion order
		const all = await runGraph(
			on(people, "find", { tableName: "legacy", columns: ["*"], conditions: [] }),
			{ body: {} },
		);
		expect((all.body as { name: string }[]).map((r) => r.name)).toEqual(["one", "two"]);
	});
});

import { beforeEach, describe, expect, it } from "bun:test";
import type { Engine } from "../src/engines";
import { resetDatabase } from "../src/engines";
import { type GraphFixture, loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/**
 * #504: sort as a list, the primary key as the last tiebreaker, and sort on
 * get-single. Rows are asserted in exact order — the order is the feature.
 *
 * Seed (`PEOPLE`), in insert (= key) order:
 *   1 Ada Lovelace     red   36
 *   2 Grace Hopper     blue  85
 *   3 100% Real_Name\  red   41
 *   4 C++ (dev) [x].*  blue  18
 *   5 Ghost            red   (no age)
 */
const people = await loadGraph("conditions/people");
const peopleSingle = await loadGraph("conditions/people-single");

const ADA = "Ada Lovelace";
const GRACE = "Grace Hopper";
const PCT = "100% Real_Name\\";
const PLUS = "C++ (dev) [x].*";
const GHOST = "Ghost";
const KEY_ORDER = [ADA, GRACE, PCT, PLUS, GHOST];

type Sort = { attribute: unknown; direction: "asc" | "desc" };
const asc = (attribute: unknown): Sort => ({ attribute, direction: "asc" });
const desc = (attribute: unknown): Sort => ({ attribute, direction: "desc" });
const fromBody = (key: string) => `js:return getRequestBody().${key};`;

function withData(
	graph: GraphFixture,
	engine: Engine,
	data: Record<string, unknown>,
): GraphFixture {
	return {
		...graph,
		engine,
		blocks: graph.blocks.map((b) =>
			b.id === "find" ? { ...b, data: { ...(b.data as object), ...data } } : b,
		) as GraphFixture["blocks"],
	};
}

/** get all, no conditions, with this sort and page */
function list(engine: Engine, sort: unknown, body: Record<string, unknown> = {}, page = {}) {
	return runGraph(withData(people, engine, { conditions: [], sort, ...page }), { body });
}

const names = (run: { body: unknown }) => (run.body as { name: string }[]).map((r) => r.name);

const team = (value: string) => ({
	attribute: { kind: "column", value: "team" },
	operator: "eq",
	value: { kind: "literal", value },
	chain: "and",
});

for (const engine of ["pg", "mysql", "mongo"] as const) {
	describe(`sort on ${engine}`, () => {
		beforeEach(() => resetDatabase(engine));

		describe("get all", () => {
			it("sorts by the first entry, then the next on ties", async () => {
				const run = await list(engine, [asc("team"), desc("name")]);
				expect(run.status).toBe(200);
				expect(names(run)).toEqual([GRACE, PLUS, GHOST, ADA, PCT]);
			});

			it("the order of the entries matters, not just which ones", async () => {
				const run = await list(engine, [desc("name"), asc("team")]);
				expect(names(run)).toEqual([GRACE, GHOST, PLUS, ADA, PCT]);
			});

			it("breaks ties by primary key, so rows that tie keep insert order", async () => {
				const run = await list(engine, [asc("team")]);
				expect(names(run)).toEqual([GRACE, PLUS, ADA, PCT, GHOST]);
			});

			it("breaks ties by key even after the rows moved on disk", async () => {
				// an UPDATE rewrites Ada at the end of the Postgres heap, so a scan
				// meets her last: only the key tiebreaker still puts her first
				const touched = withData(people, engine, { conditions: [], sort: [asc("team")] });
				touched.blocks.push({
					id: "touch",
					type: "db_update",
					position: { x: 120, y: 120 },
					data: {
						blockName: "Rewrite Ada",
						connection: "primary",
						tableName: "people",
						conditions: [
							{
								attribute: { kind: "column", value: "name" },
								operator: "eq",
								value: { kind: "literal", value: ADA },
								chain: "and",
							},
						],
						data: { source: "raw", value: { age: 36 } },
						useParam: false,
					},
				} as GraphFixture["blocks"][number]);
				touched.edges = [
					{ id: "e-entry-touch", from: "entry", to: "touch", fromHandle: "source", toHandle: "source" },
					{ id: "e-touch-find", from: "touch", to: "find", fromHandle: "source", toHandle: "source" },
					{ id: "e-find-reply", from: "find", to: "reply", fromHandle: "source", toHandle: "source" },
				] as GraphFixture["edges"];

				const run = await runGraph(touched, { body: {} });
				expect(run.status).toBe(200);
				expect(names(run)).toEqual([GRACE, PLUS, ADA, PCT, GHOST]);
			});

			it("pages through ties one row at a time without repeating or skipping", async () => {
				const seen: string[] = [];
				for (let offset = 0; offset < KEY_ORDER.length + 1; offset++) {
					const run = await list(engine, [desc("team")], {}, { limit: 1, offset });
					seen.push(...names(run));
				}
				expect(seen).toEqual([ADA, PCT, GHOST, GRACE, PLUS]);
			});

			it("a key sorted by the user keeps the user's direction", async () => {
				// on Mongo, id means _id
				const run = await list(engine, [asc("team"), desc("id")]);
				expect(names(run)).toEqual([PLUS, GRACE, GHOST, PCT, ADA]);
			});

			it("no sort at all is key order", async () => {
				expect(names(await list(engine, []))).toEqual(KEY_ORDER);
			});

			it("still reads a graph saved with one sort object", async () => {
				const run = await list(engine, { attribute: "name", direction: "desc" });
				expect(names(run)).toEqual([GRACE, GHOST, PLUS, ADA, PCT]);
			});

			it("takes a sort column from the request", async () => {
				const run = await list(engine, [desc(fromBody("sortBy"))], { sortBy: "name" });
				expect(names(run)).toEqual([GRACE, GHOST, PLUS, ADA, PCT]);
			});

			it("skips a sort column the request did not send, keeping the rest", async () => {
				const run = await list(engine, [desc(fromBody("sortBy")), asc("team")]);
				expect(names(run)).toEqual([GRACE, PLUS, ADA, PCT, GHOST]);
			});

			it("fails the block when a sort column comes out blank", async () => {
				const run = await list(engine, [asc(fromBody("sortBy"))], { sortBy: "  " });
				expect(run.status).toBeGreaterThanOrEqual(400);
				expect(run.executed).not.toContain("reply");
			});

			it("never runs a sort column from the request as query text", async () => {
				const hostile = "name; DROP TABLE people; --";
				const run = await list(engine, [asc(fromBody("sortBy"))], { sortBy: hostile });
				// Mongo takes any field name: it sorts by a field no document has
				if (engine !== "mongo") {
					expect(run.status).toBeGreaterThanOrEqual(400);
				}
				// either way the table is still there, rows and all
				expect(names(await list(engine, []))).toEqual(KEY_ORDER);
			});
		});

		describe("get single", () => {
			const single = (data: Record<string, unknown>, body = {}) =>
				runGraph(withData(peopleSingle, engine, data), { body });
			const name = (run: { body: unknown }) => (run.body as { name: string } | null)?.name;

			it("picks the first row of the sort", async () => {
				// blue has no missing age: where a null sorts differs per database
				const run = await single({ conditions: [team("blue")], sort: [desc("age")] });
				expect(run.status).toBe(200);
				expect(name(run)).toBe(GRACE);
			});

			it("breaks ties by primary key", async () => {
				expect(name(await single({ sort: [desc("team")] }))).toBe(ADA);
				expect(name(await single({ sort: [asc("team")] }))).toBe(GRACE);
			});

			it("uses every entry, in order", async () => {
				expect(name(await single({ sort: [asc("team"), asc("name")] }))).toBe(PLUS);
				expect(name(await single({ sort: [asc("name"), asc("team")] }))).toBe(PCT);
			});

			it("skips an unsent sort column; with none left it just finds a match", async () => {
				const run = await single({ conditions: [team("blue")], sort: [desc(fromBody("sortBy"))] });
				expect([GRACE, PLUS]).toContain(name(run));
			});
		});
	});
}

import { describe, expect, it } from "bun:test";
import { type GraphFixture, loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/**
 * #519: If and Array Operations conditions read like the DB blocks — each
 * chain joins everything before it, strictly left to right, and groups are
 * brackets. Cases are built so the old AND-before-OR answer differs.
 */
const branch = await loadGraph("conditions/branch");
const filter = await loadGraph("conditions/filter");

type Chain = "and" | "or";
type Cond = Record<string, unknown>;

/** `input.<key> == value`; input is the request body on If, the item on a filter */
const is = (key: string, value: unknown = true, chain: Chain = "and"): Cond => ({
	lhs: `js:return input.${key};`,
	rhs: value,
	operator: "eq",
	chain,
});
const or = (condition: Cond): Cond => ({ ...condition, chain: "or" });
const group = (items: Cond[], chain: Chain = "and"): Cond => ({ group: items, chain });

function withData(graph: GraphFixture, blockId: string, data: Record<string, unknown>): GraphFixture {
	return {
		...graph,
		blocks: graph.blocks.map((b) =>
			b.id === blockId ? { ...b, data: { ...(b.data as object), ...data } } : b,
		) as GraphFixture["blocks"],
	};
}

async function branchTaken(conditions: Cond[], body: Record<string, boolean>) {
	const run = await runGraph(withData(branch, "check", { conditions }), { body });
	expect(run.status).toBe(200);
	return run.executed.includes("yes") ? "yes" : "no";
}

describe("if block conditions", () => {
	it("a OR b is true when only b is", async () => {
		expect(await branchTaken([is("a"), or(is("b"))], { a: false, b: true })).toBe("yes");
		expect(await branchTaken([is("a"), or(is("b"))], { a: false, b: false })).toBe("no");
	});

	it("goes left to right: a OR b AND c is (a OR b) AND c", async () => {
		// AND-before-OR, either way round, says yes
		expect(await branchTaken([is("a"), or(is("b")), is("c")], { a: true, b: true, c: false })).toBe(
			"no",
		);
	});

	it("a group binds first: a OR (b AND c)", async () => {
		expect(
			await branchTaken([is("a"), group([is("b"), is("c")], "or")], { a: true, b: false, c: false }),
		).toBe("yes");
	});

	it("nests: a AND (b OR (c AND d))", async () => {
		const conditions = [is("a"), group([is("b"), group([is("c"), is("d")], "or")])];
		expect(await branchTaken(conditions, { a: true, b: false, c: true, d: true })).toBe("yes");
		expect(await branchTaken(conditions, { a: true, b: false, c: true, d: false })).toBe("no");
	});

	it("drops an empty group instead of OR-ing in true", async () => {
		expect(await branchTaken([is("a"), group([], "or")], { a: false })).toBe("no");
		expect(await branchTaken([group([]), group([group([])], "or")], {})).toBe("yes");
	});

	it("ignores the chain on the first condition of a list or group", async () => {
		expect(await branchTaken([or(is("a"))], { a: false })).toBe("no");
		expect(await branchTaken([is("a"), group([or(is("b")), or(is("c"))])], { a: false, b: true, c: true })).toBe(
			"no",
		);
	});
});

describe("array operations filter conditions", () => {
	const people = [
		{ name: "ada", age: 36, admin: true },
		{ name: "grace", age: 85, admin: false },
		{ name: "linus", age: 18, admin: false },
	];
	const keep = async (filterConditions: Cond[]) => {
		const run = await runGraph(withData(filter, "keep", { filterConditions }), { body: { items: people } });
		expect(run.status).toBe(200);
		return (run.body as { name: string }[]).map((p) => p.name);
	};

	it("a OR b keeps items where only b is true", async () => {
		expect(await keep([is("name", "grace"), or(is("name", "linus"))])).toEqual(["grace", "linus"]);
	});

	it("filters on nested groups: admin OR (age > 50 AND (name = grace OR name = x))", async () => {
		const older = { lhs: "js:return input.age;", rhs: 50, operator: "gt", chain: "and" };
		expect(
			await keep([
				is("admin"),
				group([older, group([is("name", "grace"), or(is("name", "x"))])], "or"),
			]),
		).toEqual(["ada", "grace"]);
	});
});

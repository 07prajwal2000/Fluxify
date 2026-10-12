// The gates of a custom block or middleware promote, and of a route promote
// that depends on one (#740), against a real Postgres and a real NATS. A fake
// development worker answers suite runs on the real bus and fails any run whose
// custom block library holds a source that says BAD, so a verdict shows which
// version of a block a suite ran with.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createStack, FAIL, PASS, type SeenRun, type Stack } from "./blockHarness";

let stack: Stack;

beforeAll(async () => {
	stack = await createStack("blockgates");
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

const verdict = (run: SeenRun) =>
	Object.values(run.library).some((source) => source.includes("BAD")) ? FAIL : PASS;

/** block B (leaf), block A calling B, and a route R calling A with one suite: all live */
async function world() {
	const { as, project } = await stack.setup();
	const b = await stack.createBlock(as);
	await stack.setScript(as, "custom-blocks", b.id, "return 'b-one';");
	await stack.release(as, "custom-blocks", b.id);
	const a = await stack.createBlock(as);
	await stack.callBlock(as, "custom-blocks", a.id, b.name);
	await stack.release(as, "custom-blocks", a.id);
	const route = await stack.createRoute(as);
	await stack.callBlock(as, "routes", route, a.name);
	await stack.release(as, "routes", route);
	const suite = await stack.suite(as, { routeId: route });
	return { as, project, a, b, route, suite };
}

describe("promoting a custom block", () => {
	it("runs the suites of every production user, directly or through another block, with the candidate in place", async () => {
		const { as, project, a, b, route, suite } = await world();
		const seen = stack.devWorker(project, verdict);
		await stack.setScript(as, "custom-blocks", b.id, "return 'BAD';");
		const v2 = await stack.commit(as, "custom-blocks", b.id, "bad");

		const bad = await stack.deployed(as, "custom-blocks", b.id, v2);
		expect(bad.status).toBe("failed");
		const tests = stack.gate(bad, "tests");
		expect(tests).toMatchObject({ status: "failed", message: "1 of 1 test suites did not pass" });
		expect(tests.items[0]).toContain(`route "`);
		expect(tests.items[0]).toContain(suite.name);
		expect(tests.refs).toEqual([
			expect.objectContaining({ kind: "route", id: route, suite: suite.name }),
		]);
		// the route's suite ran on the candidate B, and on A as production has it
		expect(seen).toHaveLength(1);
		expect(seen[0]!.library[b.name]).toContain("BAD");
		expect(seen[0]!.library[a.name]).not.toContain("BAD");
		// production keeps B v1
		expect((await stack.call(as, "GET", `/custom-blocks/${b.id}`)).body.prodVersionNumber).toBe(1);

		await stack.setScript(as, "custom-blocks", b.id, "return 'b-three';");
		const v3 = await stack.commit(as, "custom-blocks", b.id, "fine");
		const good = await stack.deployed(as, "custom-blocks", b.id, v3);
		expect(good.status).toBe("live");
		expect(stack.gate(good, "tests")).toMatchObject({ status: "passed", message: "1 test suite passed" });
		expect((await stack.call(as, "GET", `/custom-blocks/${b.id}`)).body.prodVersionNumber).toBe(3);
	});

	it("runs the users' suites on production's library: the other blocks as promoted, not as edited", async () => {
		const { as, project, a, b } = await world();
		const seen = stack.devWorker(project);
		// A's working copy drifts and is never promoted
		await stack.setScript(as, "custom-blocks", a.id, "return 'a-working-copy';");
		await stack.setScript(as, "custom-blocks", b.id, "return 'b-two';");
		const v2 = await stack.commit(as, "custom-blocks", b.id, "two");

		const done = await stack.deployed(as, "custom-blocks", b.id, v2);
		expect(done.status).toBe("live");
		expect(seen).toHaveLength(1);
		expect(seen[0]!.library[b.name]).toContain("b-two");
		expect(seen[0]!.library[a.name]).not.toContain("a-working-copy");
	});

	it("blocks a middleware promote on a failing suite of a route that attaches it", async () => {
		const { as, project } = await stack.setup();
		const block = await stack.createBlock(as, "middleware");
		await stack.setScript(as, "custom-blocks", block.id, "return 'guard-one';");
		await stack.release(as, "custom-blocks", block.id);
		const mw = await stack.createMiddleware(as, [block.id]);
		await stack.release(as, "middlewares", mw.id);

		const route = await stack.createRoute(as);
		await stack.setScript(as, "routes", route, "return 1;");
		const set = await stack.call(as, "PUT", `/routes/${route}/middlewares`, {
			before: [mw.id],
			after: [],
		});
		expect(set.status).toBe(200);
		await stack.release(as, "routes", route);
		const suite = await stack.suite(as, { routeId: route });
		const seen = stack.devWorker(project, verdict);

		// the middleware gets a chain with a block that fails the suite
		const bad = await stack.createBlock(as, "middleware");
		await stack.setScript(as, "custom-blocks", bad.id, "return 'BAD';");
		await stack.release(as, "custom-blocks", bad.id);
		seen.length = 0;
		await stack.call(as, "PUT", `/middlewares/${mw.id}`, { blocks: [block.id, bad.id] });
		const v2 = await stack.commit(as, "middlewares", mw.id, "with bad");

		const res = await stack.deployed(as, "middlewares", mw.id, v2);
		expect(res.status).toBe("failed");
		expect(stack.gate(res, "tests").refs).toEqual([
			expect.objectContaining({ kind: "route", id: route, suite: suite.name }),
		]);
		// the route ran with the candidate chain, not the promoted one
		expect(seen).toHaveLength(1);
		expect(seen[0]!.middlewares?.before[0]?.blocks).toEqual([block.name, bad.name]);
	});

	it("passes with a warning when nothing in production uses it yet", async () => {
		const { as } = await stack.setup();
		const block = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", block.id, "return 1;");
		const id = await stack.commit(as, "custom-blocks", block.id, "one");

		const res = await stack.deploy(as, "custom-blocks", block.id, id);
		expect(res.body.status).toBe("live");
		expect(stack.gate(res.body, "tests")).toMatchObject({
			status: "warning",
			message: "Not used in production yet",
		});
	});

	it("warns, and promotes, when its users have no test suites", async () => {
		const { as } = await stack.setup();
		const block = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", block.id, "return 1;");
		await stack.release(as, "custom-blocks", block.id);
		const route = await stack.createRoute(as);
		await stack.callBlock(as, "routes", route, block.name);
		await stack.release(as, "routes", route);
		await stack.setScript(as, "custom-blocks", block.id, "return 2;");
		const v2 = await stack.commit(as, "custom-blocks", block.id, "two");

		const res = await stack.deploy(as, "custom-blocks", block.id, v2);
		expect(res.body.status).toBe("live");
		expect(stack.gate(res.body, "tests").status).toBe("warning");
		expect(stack.gate(res.body, "tests").message).toContain("No test suites");
	});

	it("runs the suites that use it as a hook, and only those", async () => {
		const { as, project } = await stack.setup();
		const hook = await stack.createBlock(as, "test");
		await stack.setScript(as, "custom-blocks", hook.id, "return 'seed-one';");
		await stack.release(as, "custom-blocks", hook.id);

		const hooked = await stack.createRoute(as);
		await stack.setScript(as, "routes", hooked, "return 1;");
		await stack.release(as, "routes", hooked);
		const other = await stack.createRoute(as);
		await stack.setScript(as, "routes", other, "return 2;");
		await stack.release(as, "routes", other);
		const usesHook = await stack.suite(as, { routeId: hooked }, { setup: hook.id });
		await stack.suite(as, { routeId: hooked });
		await stack.suite(as, { routeId: other });
		const seen = stack.devWorker(project);

		await stack.setScript(as, "custom-blocks", hook.id, "return 'seed-two';");
		const v2 = await stack.commit(as, "custom-blocks", hook.id, "two");
		const res = await stack.deployed(as, "custom-blocks", hook.id, v2);

		expect(res.status).toBe("live");
		expect(stack.gate(res, "tests")).toMatchObject({ status: "passed", message: "1 test suite passed" });
		expect(seen.map((run) => run.suite.id)).toEqual([usesHook.id]);
		expect(seen[0]!.library[hook.name]).toContain("seed-two");
		// the other suite of the same route, and the other route, did not run
	});

	it("ends on a cycle between two promoted versions instead of looping", async () => {
		const { as, project, a, b } = await world();
		const seen = stack.devWorker(project);
		// B's promoted version now calls A, which calls B: a canvas save refuses it, a version can hold it
		await stack.sql`UPDATE canvas_versions
			SET snapshot = jsonb_set(snapshot, '{blocks}', ${JSON.stringify([
				{ id: Bun.randomUUIDv7(), key: "x_1", type: a.name, data: {}, position: { x: 0, y: 0 } },
			])}::text::jsonb)
			WHERE id = (SELECT prod_version_id FROM custom_blocks_list WHERE id = ${b.id})`;
		await stack.setScript(as, "custom-blocks", b.id, "return 'b-two';");
		const v2 = await stack.commit(as, "custom-blocks", b.id, "two");

		const res = await stack.deployed(as, "custom-blocks", b.id, v2);
		expect(res.status).toBe("live");
		expect(seen).toHaveLength(1);
	});

	it("fails to compile, and checks the values the block uses", async () => {
		const { as } = await stack.setup();
		const block = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", block.id, "return getConfig('NO_SUCH_KEY_740');");
		const v1 = await stack.commit(as, "custom-blocks", block.id, "uses a key");
		const noValue = await stack.deploy(as, "custom-blocks", block.id, v1);
		expect(noValue.body.status).toBe("failed");
		expect(stack.gate(noValue.body, "values")).toMatchObject({
			status: "failed",
			items: ["app config key NO_SUCH_KEY_740 has no production value"],
		});

		// a version that calls a block that is gone does not compile
		await stack.sql`UPDATE canvas_versions
			SET snapshot = jsonb_set(snapshot, '{blocks}', (
				SELECT jsonb_agg(CASE WHEN b->>'type' = 'jsrunner' THEN jsonb_set(b, '{type}', '"user_defined.project.gone"') ELSE b END)
				FROM jsonb_array_elements(snapshot->'blocks') b))
			WHERE id = ${v1}`;
		const broken = await stack.deploy(as, "custom-blocks", block.id, v1);
		expect(stack.gate(broken.body, "compile").status).toBe("failed");
	});
});

describe("promoting a route that uses custom blocks", () => {
	it("fails and lists every dependency with no production version, with kind, id and name", async () => {
		const { as } = await stack.setup();
		const direct = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", direct.id, "return 1;");
		const mw = await stack.createMiddleware(as, []);
		const route = await stack.createRoute(as);
		await stack.callBlock(as, "routes", route, direct.name);
		await stack.call(as, "PUT", `/routes/${route}/middlewares`, { before: [mw.id], after: [] });
		const v1 = await stack.commit(as, "routes", route, "uses both");

		const res = await stack.deploy(as, "routes", route, v1);
		expect(res.body.status).toBe("failed");
		const blocks = stack.gate(res.body, "custom_blocks");
		expect(blocks.status).toBe("failed");
		expect(blocks.refs).toEqual(
			expect.arrayContaining([
				{ kind: "custom_block", id: direct.id, name: direct.name },
				{ kind: "middleware", id: mw.id, name: mw.name },
			]),
		);
		expect(blocks.items).toHaveLength(2);
		// the tests do not run behind a failed check
		expect(stack.gate(res.body, "tests").status).toBe("skipped");

		// promote each one, and the route goes live: there is no automatic chain
		await stack.release(as, "custom-blocks", direct.id);
		await stack.release(as, "middlewares", mw.id);
		const again = await stack.deploy(as, "routes", route, v1);
		expect(again.body.status).toBe("live");
		expect(stack.gate(again.body, "custom_blocks").status).toBe("passed");
	});

	it("follows uses of uses: the block a promoted block calls must be live too", async () => {
		const { as, a, b, route } = await world();
		// B loses its production version, as it would after a delete of its history
		await stack.sql`UPDATE custom_blocks_list SET prod_version_id = NULL WHERE id = ${b.id}`;
		await stack.callBlock(as, "routes", route, a.name, { note: "edited" });
		const v = await stack.commit(as, "routes", route, "edit");

		const res = await stack.deploy(as, "routes", route, v);
		expect(res.body.status).toBe("failed");
		expect(stack.gate(res.body, "custom_blocks").refs).toEqual([
			{ kind: "custom_block", id: b.id, name: b.name },
		]);
		
	});

	it("lists a suite's hook with no production version, which its production test runs call", async () => {
		const { as } = await stack.setup();
		const hook = await stack.createBlock(as, "test");
		await stack.setScript(as, "custom-blocks", hook.id, "return 1;");
		const route = await stack.createRoute(as);
		await stack.setScript(as, "routes", route, "return 1;");
		await stack.suite(as, { routeId: route }, { setup: hook.id });
		const v1 = await stack.commit(as, "routes", route, "one");

		const res = await stack.deploy(as, "routes", route, v1);
		expect(res.body.status).toBe("failed");
		expect(stack.gate(res.body, "custom_blocks").refs).toEqual([
			{ kind: "custom_block", id: hook.id, name: hook.name },
		]);
	});

	it("tests the version against its dependencies' production versions, not their working copies", async () => {
		const { as, project, a, route } = await world();
		const seen = stack.devWorker(project, verdict);
		// the working copy of A is broken for the suite; production's A is fine
		await stack.setScript(as, "custom-blocks", a.id, "return 'BAD';");
		await stack.callBlock(as, "routes", route, a.name, { note: "route-two" });
		const v2 = await stack.commit(as, "routes", route, "two");

		const done = await stack.deployed(as, "routes", route, v2);
		expect(done.status).toBe("live");
		expect(stack.gate(done, "tests").status).toBe("passed");
		expect(seen).toHaveLength(1);
		expect(seen[0]!.library[a.name]).not.toContain("BAD");
		expect(seen[0]!.source).toContain("route-two");
	});
});

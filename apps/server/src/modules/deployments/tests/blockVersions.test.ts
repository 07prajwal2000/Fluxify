// Custom block and middleware versions (#740) against a real Postgres and a
// real NATS: the HTTP API commits, restores and promotes, and the real compiler
// publishes what each environment would serve. Development runs the working
// copy, production the promoted version, so the two buckets must differ.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createStack, type Stack } from "./blockHarness";

let stack: Stack;

beforeAll(async () => {
	stack = await createStack("blockversions");
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

beforeEach(() => {
	stack.signals.length = 0;
});

describe("custom block versions", () => {
	it("commits and checks out its canvas and inputs, and a commit is not an edit", async () => {
		const { as } = await stack.setup();
		const block = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", block.id, "return 'one';");
		const before = (await stack.call(as, "GET", `/custom-blocks/${block.id}`)).body;
		expect(before).toMatchObject({ headVersionNumber: null, prodVersionNumber: null, uncommitted: true });

		const v1 = await stack.commit(as, "custom-blocks", block.id, "one");
		expect((await stack.call(as, "GET", `/custom-blocks/${block.id}`)).body).toMatchObject({
			headVersionNumber: 1,
			uncommitted: false,
		});
		expect((await stack.call(as, "POST", `/custom-blocks/${block.id}/versions`, { title: "again" })).status).toBe(409);

		// a change to the inputs is part of a version, so it makes the copy uncommitted again
		const inputs = [{ type: "text_input", name: "who", label: "Who" }];
		await stack.call(as, "PUT", `/custom-blocks/${block.id}`, { inputParams: inputs });
		expect((await stack.call(as, "GET", `/custom-blocks/${block.id}`)).body.uncommitted).toBe(true);
		await stack.setScript(as, "custom-blocks", block.id, "return 'two';");
		const v2 = await stack.commit(as, "custom-blocks", block.id, "two");

		const snapshot = (await stack.call(as, "GET", `/custom-blocks/${block.id}/versions/${v2}`)).body.snapshot;
		expect(snapshot.settings).toEqual({ inputParams: inputs, usage: "flow" });
		expect(JSON.stringify(snapshot.blocks)).toContain("return 'two';");

		// the label is live: a rename-ish edit of it is no change to commit
		await stack.call(as, "PUT", `/custom-blocks/${block.id}`, { label: "Renamed" });
		expect((await stack.call(as, "GET", `/custom-blocks/${block.id}`)).body.uncommitted).toBe(false);

		const back = await stack.call(as, "POST", `/custom-blocks/${block.id}/versions/${v1}/checkout`, {});
		expect(back.status).toBe(200);
		expect(back.body.checkedOut).toMatchObject({ kind: "custom_block", targetId: block.id, versionNumber: 1 });
		const restored = (await stack.call(as, "GET", `/custom-blocks/${block.id}`)).body;
		expect(restored.inputParams).toBeNull();
		expect(JSON.stringify(await stack.canvas(as, "custom-blocks", block.id))).toContain("return 'one';");
		expect(stack.signals).toContainEqual({ chan: "chan:on-custom-block-change", id: block.id });

		const list = (await stack.call(as, "GET", `/custom-blocks/${block.id}/versions`)).body;
		expect(list.versions.map((v: any) => [v.versionNumber, v.isHead, v.kind])).toEqual([
			[2, false, "custom_block"],
			[1, true, "custom_block"],
		]);
		// viewers read the history but cannot commit
		const viewer = { ...as, role: "viewer" };
		expect((await stack.call(viewer, "GET", `/custom-blocks/${block.id}/versions`)).status).toBe(200);
		expect((await stack.call(viewer, "POST", `/custom-blocks/${block.id}/versions`, { title: "no" })).status).toBe(403);
	});

	it("serves production from the promoted version and development from the working copy", async () => {
		const { as, project } = await stack.setup();
		const block = await stack.createBlock(as);

		// nothing promoted: no production artifact, whatever the working copy says
		await stack.setScript(as, "custom-blocks", block.id, "return 'one';");
		await stack.compileBlock(block.id);
		expect(await stack.blockArtifact(project, block.id, "production")).toBeNull();
		expect((await stack.blockArtifact(project, block.id, "development"))?.source).toContain("('one')");

		const v1 = await stack.release(as, "custom-blocks", block.id, "first");
		await stack.setScript(as, "custom-blocks", block.id, "return 'two';");
		const v2 = await stack.commit(as, "custom-blocks", block.id, "two");
		// the working copy moves again before anything is promoted
		await stack.setScript(as, "custom-blocks", block.id, "return 'three';");
		await stack.compileBlock(block.id);
		expect((await stack.blockArtifact(project, block.id, "production"))?.source).toContain("('one')");
		expect((await stack.blockArtifact(project, block.id, "development"))?.source).toContain("('three')");

		stack.signals.length = 0;
		const promoted = await stack.deploy(as, "custom-blocks", block.id, v2, "second");
		expect(promoted.body).toMatchObject({ status: "live", action: "promote", kind: "custom_block", versionNumber: 2 });
		expect(stack.signals).toContainEqual({ chan: "chan:on-custom-block-change", id: block.id });
		await stack.compileBlock(block.id);
		expect((await stack.blockArtifact(project, block.id, "production"))?.source).toContain("('two')");
		expect((await stack.blockArtifact(project, block.id, "development"))?.source).toContain("('three')");

		const back = await stack.deploy(as, "custom-blocks", block.id, v1, "it broke");
		expect(back.body).toMatchObject({ status: "live", action: "rollback", versionNumber: 1 });
		await stack.compileBlock(block.id);
		expect((await stack.blockArtifact(project, block.id, "production"))?.source).toContain("('one')");

		const log = (await stack.call(as, "GET", `/custom-blocks/${block.id}/deployments`)).body.deployments;
		expect(log.map((d: any) => [d.versionNumber, d.action, d.status])).toEqual([
			[1, "rollback", "live"],
			[2, "promote", "live"],
			[1, "promote", "live"],
		]);
		expect((await stack.call(as, "GET", `/custom-blocks/${block.id}`)).body).toMatchObject({
			prodVersionNumber: 1,
		});
		expect((await stack.deploy(as, "custom-blocks", block.id, v1)).status).toBe(409);
	});

	it("runs every production route on the promoted block, and rollback puts the old one back everywhere", async () => {
		const { as, project } = await stack.setup();
		const block = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", block.id, "return 'v1';");
		const v1 = await stack.release(as, "custom-blocks", block.id);
		await stack.compileBlock(block.id);

		const routes: string[] = [];
		for (let i = 0; i < 2; i++) {
			const id = await stack.createRoute(as);
			await stack.callBlock(as, "routes", id, block.name);
			await stack.release(as, "routes", id);
			routes.push(id);
		}
		await stack.setScript(as, "custom-blocks", block.id, "return 'v2';");
		const v2 = await stack.commit(as, "custom-blocks", block.id, "v2");

		// no route is rebuilt by the promote: they call the block by name, so one
		// artifact is what changes for all of them
		await stack.deploy(as, "custom-blocks", block.id, v2);
		await stack.compileBlock(block.id);
		const live = await stack.blockArtifact(project, block.id, "production");
		expect(live?.source).toContain("('v2')");
		for (const id of routes) {
			await stack.compileRoute(id);
			expect((await stack.routeArtifact(project, id, "production"))?.source).toContain(block.name);
		}

		await stack.deploy(as, "custom-blocks", block.id, v1, "rollback");
		await stack.compileBlock(block.id);
		expect((await stack.blockArtifact(project, block.id, "production"))?.source).toContain("('v1')");
	});

	it("keeps the name live: a version never carries it", async () => {
		const { as, project } = await stack.setup();
		const block = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", block.id, "return 1;");
		const v1 = await stack.release(as, "custom-blocks", block.id);
		const snapshot = (await stack.call(as, "GET", `/custom-blocks/${block.id}/versions/${v1}`)).body.snapshot;
		expect(JSON.stringify(snapshot)).not.toContain(block.name);
		await stack.compileBlock(block.id);
		expect((await stack.blockArtifact(project, block.id, "production"))?.name).toBe(block.name);
	});
});

describe("middleware versions", () => {
	async function liveBlock(as: any, script: string) {
		const block = await stack.createBlock(as, "middleware");
		await stack.setScript(as, "custom-blocks", block.id, script);
		await stack.release(as, "custom-blocks", block.id);
		return block;
	}

	it("commits its chain, restores it, and drops a block that is gone with a warning", async () => {
		const { as } = await stack.setup();
		const a = await liveBlock(as, "return 1;");
		const b = await liveBlock(as, "return 2;");
		const mw = await stack.createMiddleware(as, [a.id]);
		const v1 = await stack.commit(as, "middlewares", mw.id, "just a");
		await stack.call(as, "PUT", `/middlewares/${mw.id}`, { blocks: [a.id, b.id] });
		expect((await stack.call(as, "GET", `/middlewares/${mw.id}`)).body.uncommitted).toBe(true);
		const v2 = await stack.commit(as, "middlewares", mw.id, "a then b");

		const snapshot = (await stack.call(as, "GET", `/middlewares/${mw.id}/versions/${v2}`)).body.snapshot;
		expect(snapshot).toMatchObject({ blocks: [], edges: [], settings: { chain: [a.id, b.id] } });

		// the name is live: renaming is no change to commit
		await stack.call(as, "PUT", `/middlewares/${mw.id}`, { name: `${mw.name}-renamed` });
		expect((await stack.call(as, "GET", `/middlewares/${mw.id}`)).body.uncommitted).toBe(false);

		stack.signals.length = 0;
		const back = await stack.call(as, "POST", `/middlewares/${mw.id}/versions/${v1}/checkout`, {});
		expect(back.status).toBe(200);
		expect(stack.signals).toContainEqual({ chan: "compile:middleware", id: mw.id });
		expect(back.body.checkedOut.kind).toBe("middleware");
		const chain = (await stack.call(as, "GET", `/middlewares/${mw.id}`)).body.blocks.map((x: any) => x.id);
		expect(chain).toEqual([a.id]);
	});

	it("serves production from its promoted chain and development from the working chain", async () => {
		const { as, project } = await stack.setup();
		const a = await liveBlock(as, "return 1;");
		const b = await liveBlock(as, "return 2;");
		const mw = await stack.createMiddleware(as, [a.id]);
		await stack.compileMiddleware(mw.id);
		// not promoted: production has nothing
		expect(await stack.middlewareArtifact(project, mw.id, "production")).toBeNull();

		const v1 = await stack.release(as, "middlewares", mw.id);
		await stack.call(as, "PUT", `/middlewares/${mw.id}`, { blocks: [a.id, b.id] });
		await stack.compileMiddleware(mw.id);
		expect((await stack.middlewareArtifact(project, mw.id, "production"))?.blocks).toEqual([a.name]);
		expect((await stack.middlewareArtifact(project, mw.id, "development"))?.blocks).toEqual([a.name, b.name]);

		const v2 = await stack.commit(as, "middlewares", mw.id, "a then b");
		stack.signals.length = 0;
		await stack.deploy(as, "middlewares", mw.id, v2);
		// a promote tells the compiler, which rebuilds production's chain
		expect(stack.signals).toContainEqual({ chan: "compile:middleware", id: mw.id });
		await stack.compileMiddleware(mw.id);
		expect((await stack.middlewareArtifact(project, mw.id, "production"))?.blocks).toEqual([a.name, b.name]);

		const back = await stack.deploy(as, "middlewares", mw.id, v1);
		expect(back.body).toMatchObject({ status: "live", action: "rollback" });
		await stack.compileMiddleware(mw.id);
		expect((await stack.middlewareArtifact(project, mw.id, "production"))?.blocks).toEqual([a.name]);
	});

	it("fails the promote and lists a chain block with no production version", async () => {
		const { as } = await stack.setup();
		const live = await liveBlock(as, "return 1;");
		const draft = await stack.createBlock(as, "middleware");
		await stack.setScript(as, "custom-blocks", draft.id, "return 2;");
		const mw = await stack.createMiddleware(as, [live.id, draft.id]);
		const v1 = await stack.commit(as, "middlewares", mw.id, "both");

		const res = await stack.deploy(as, "middlewares", mw.id, v1);
		expect(res.body.status).toBe("failed");
		expect(stack.gate(res.body, "custom_blocks")).toMatchObject({
			status: "failed",
			refs: [{ kind: "custom_block", id: draft.id, name: draft.name }],
		});
		expect((await stack.call(as, "GET", `/middlewares/${mw.id}`)).body.prodVersionNumber).toBeNull();
	});
});

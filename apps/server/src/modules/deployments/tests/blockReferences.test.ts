// Who uses a custom block or a middleware, and the delete guard behind it
// (#740), against a real Postgres and a real NATS. Sandboxes are not users: they
// are never listed and never block a delete.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createStack, type Stack } from "./blockHarness";

let stack: Stack;

beforeAll(async () => {
	stack = await createStack("blockrefs");
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

const key = (n: number) => `k_${n}_${Math.random().toString(36).slice(2, 8)}`;

/** a sandbox whose canvas runs an instance of the custom block `type` */
async function sandboxUsing(project: string, userId: string, type: string) {
	const id = Bun.randomUUIDv7();
	const entry = Bun.randomUUIDv7();
	const call = Bun.randomUUIDv7();
	await stack.sql`INSERT INTO sandboxes (id, project_id, user_id, name) VALUES (${id}, ${project}, ${userId}, 'scratch')`;
	await stack.sql`INSERT INTO blocks (id, key, type, position, data, sandbox_id)
		VALUES (${entry}, ${key(1)}, 'entrypoint', '{"x":0,"y":0}'::jsonb, '{}'::jsonb, ${id}),
			(${call}, ${key(2)}, ${type}, '{"x":240,"y":0}'::jsonb, '{"invoke":"sync"}'::jsonb, ${id})`;
	// the compiler only emits what the entrypoint reaches, so the call has to be wired in
	await stack.sql`INSERT INTO edges (id, "from", "to", from_handle, to_handle, sandbox_id)
		VALUES (${Bun.randomUUIDv7()}, ${entry}, ${call}, ${`${entry}-source`}, ${`${call}-target`}, ${id})`;
	return id;
}

const refs = async (as: any, base: string, id: string) =>
	(await stack.call(as, "GET", `/${base}/${id}/references`)).body.references as any[];

describe("references", () => {
	it("lists every kind of user with where it runs, and never a sandbox", async () => {
		const { as, project, userId } = await stack.setup();
		const x = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", x.id, "return 1;");
		await stack.release(as, "custom-blocks", x.id);

		// working copy only
		const draft = await stack.createRoute(as);
		await stack.callBlock(as, "routes", draft, x.name);
		// promoted, then edited to let go of the block: production still runs it
		const live = await stack.createRoute(as);
		await stack.callBlock(as, "routes", live, x.name);
		await stack.release(as, "routes", live);
		await stack.setScript(as, "routes", live, "return 2;");
		// both
		const both = await stack.createRoute(as);
		await stack.callBlock(as, "routes", both, x.name);
		await stack.release(as, "routes", both);
		const workflow = await stack.createWorkflow(as);
		await stack.callBlock(as, "workflows", workflow, x.name);
		const user = await stack.createBlock(as);
		await stack.callBlock(as, "custom-blocks", user.id, x.name);
		const sandbox = await sandboxUsing(project, userId, x.name);

		const found = await refs(as, "custom-blocks", x.id);
		const by = (id: string) => found.find((r) => r.id === id);
		expect(by(draft)).toMatchObject({ kind: "route", inWorkingCopy: true, inProduction: false });
		expect(by(live)).toMatchObject({ kind: "route", inWorkingCopy: false, inProduction: true });
		expect(by(both)).toMatchObject({ kind: "route", inWorkingCopy: true, inProduction: true });
		expect(by(workflow)).toMatchObject({ kind: "workflow", inWorkingCopy: true, inProduction: false });
		expect(by(user.id)).toMatchObject({ kind: "custom_block", name: user.name, inWorkingCopy: true });
		expect(found.map((r) => r.id)).not.toContain(sandbox);
		expect(found).toHaveLength(5);
		for (const r of found) expect(Object.keys(r)).toEqual(expect.arrayContaining(["kind", "id", "name", "inProduction"]));
	});

	it("lists the middlewares that chain a block and the suites that hook it", async () => {
		const { as, project } = await stack.setup();
		const link = await stack.createBlock(as, "middleware");
		await stack.setScript(as, "custom-blocks", link.id, "return 1;");
		await stack.release(as, "custom-blocks", link.id);
		const mw = await stack.createMiddleware(as, [link.id]);

		expect(await refs(as, "custom-blocks", link.id)).toEqual([
			expect.objectContaining({ kind: "middleware", id: mw.id, name: mw.name, inProduction: false }),
		]);
		await stack.release(as, "middlewares", mw.id);
		expect((await refs(as, "custom-blocks", link.id))[0]).toMatchObject({ inProduction: true });

		const hook = await stack.createBlock(as, "test");
		await stack.setScript(as, "custom-blocks", hook.id, "return 1;");
		await stack.release(as, "custom-blocks", hook.id);
		const route = await stack.createRoute(as);
		await stack.setScript(as, "routes", route, "return 1;");
		const suite = await stack.suite(as, { routeId: route }, { teardown: hook.id });
		stack.devWorker(project);
		const found = await refs(as, "custom-blocks", hook.id);
		expect(found).toEqual([
			expect.objectContaining({
				kind: "test_suite",
				id: suite.id,
				name: suite.name,
				// its route is not promoted, so no production run calls the hook yet
				inProduction: false,
				target: { kind: "route", id: route, name: expect.any(String) },
			}),
		]);
		await stack.release(as, "routes", route);
		expect((await refs(as, "custom-blocks", hook.id))[0]).toMatchObject({ inProduction: true });
	});

	it("lists the routes that attach a middleware, in a working copy or a promoted version", async () => {
		const { as } = await stack.setup();
		const mw = await stack.createMiddleware(as, []);
		await stack.release(as, "middlewares", mw.id);
		const working = await stack.createRoute(as);
		await stack.setScript(as, "routes", working, "return 1;");
		await stack.call(as, "PUT", `/routes/${working}/middlewares`, { before: [mw.id], after: [] });
		const promoted = await stack.createRoute(as);
		await stack.setScript(as, "routes", promoted, "return 1;");
		await stack.call(as, "PUT", `/routes/${promoted}/middlewares`, { before: [], after: [mw.id] });
		await stack.release(as, "routes", promoted);
		await stack.call(as, "PUT", `/routes/${promoted}/middlewares`, { before: [], after: [] });

		const found = await refs(as, "middlewares", mw.id);
		expect(found.find((r) => r.id === working)).toMatchObject({ inWorkingCopy: true, inProduction: false });
		expect(found.find((r) => r.id === promoted)).toMatchObject({ inWorkingCopy: false, inProduction: true });
		expect(found).toHaveLength(2);
	});

	it("is for people who can see the project", async () => {
		const { as } = await stack.setup();
		const block = await stack.createBlock(as);
		const stranger = { user: "someone", project: "another-project" };
		expect((await stack.call({ ...as, role: "viewer" }, "GET", `/custom-blocks/${block.id}/references`)).status).toBe(200);
		expect((await stack.call(stranger, "GET", `/custom-blocks/${block.id}/references`)).status).toBe(403);
		expect((await stack.call(as, "GET", `/custom-blocks/${Bun.randomUUIDv7()}/references`)).status).toBe(404);
	});
});

describe("deleting a custom block", () => {
	async function refused(as: any, id: string) {
		const res = await stack.call(as, "DELETE", `/custom-blocks/${id}`);
		expect(res.status).toBe(409);
		return res.body as { message: string; references: any[] };
	}

	it("is refused while a working copy uses it, and says who", async () => {
		const { as } = await stack.setup();
		const x = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", x.id, "return 1;");
		const route = await stack.createRoute(as);
		await stack.callBlock(as, "routes", route, x.name);

		const body = await refused(as, x.id);
		expect(body.references).toEqual([
			expect.objectContaining({ kind: "route", id: route, inWorkingCopy: true }),
		]);
		expect(body.message).toContain(`(${route})`);
		expect(body.message).toContain("route");

		// the user lets go, and the delete goes through
		await stack.setScript(as, "routes", route, "return 2;");
		expect((await stack.call(as, "DELETE", `/custom-blocks/${x.id}`)).status).toBe(200);
		expect((await stack.call(as, "GET", `/custom-blocks/${x.id}`)).status).toBe(404);
	});

	it("is refused for each other kind of user: workflow, block, middleware chain, hook", async () => {
		const { as } = await stack.setup();
		const flow = await stack.createBlock(as);
		const workflow = await stack.createWorkflow(as);
		await stack.callBlock(as, "workflows", workflow, flow.name);
		expect((await refused(as, flow.id)).references[0]).toMatchObject({ kind: "workflow", id: workflow });
		await stack.setScript(as, "workflows", workflow, "return 1;");

		const caller = await stack.createBlock(as);
		await stack.callBlock(as, "custom-blocks", caller.id, flow.name);
		expect((await refused(as, flow.id)).references[0]).toMatchObject({ kind: "custom_block", id: caller.id });

		const link = await stack.createBlock(as, "middleware");
		const mw = await stack.createMiddleware(as, [link.id]);
		expect((await refused(as, link.id)).references[0]).toMatchObject({ kind: "middleware", id: mw.id });

		const hook = await stack.createBlock(as, "test");
		const route = await stack.createRoute(as);
		const suite = await stack.suite(as, { routeId: route }, { setup: hook.id });
		expect((await refused(as, hook.id)).references[0]).toMatchObject({ kind: "test_suite", id: suite.id });
		// the loader of a workflow suite is a hook as well
		const loader = await stack.createBlock(as, "test");
		const wf = await stack.createWorkflow(as);
		const loaderSuite = await stack.suite(as, { workflowId: wf }, { loader: loader.id });
		expect((await refused(as, loader.id)).references[0]).toMatchObject({ kind: "test_suite", id: loaderSuite.id });
	});

	it("is refused while a promoted version uses it, though no working copy does", async () => {
		const { as } = await stack.setup();
		const x = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", x.id, "return 1;");
		await stack.release(as, "custom-blocks", x.id);
		const route = await stack.createRoute(as);
		await stack.callBlock(as, "routes", route, x.name);
		await stack.release(as, "routes", route);
		await stack.setScript(as, "routes", route, "return 2;");

		const body = await refused(as, x.id);
		expect(body.references).toEqual([
			expect.objectContaining({ kind: "route", id: route, inProduction: true, inWorkingCopy: false }),
		]);

		// promoting the route without it frees the block
		await stack.release(as, "routes", route);
		expect((await stack.call(as, "DELETE", `/custom-blocks/${x.id}`)).status).toBe(200);
	});

	it("is not blocked by an old version that is not live", async () => {
		const { as } = await stack.setup();
		const x = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", x.id, "return 1;");
		await stack.release(as, "custom-blocks", x.id);
		const route = await stack.createRoute(as);
		await stack.callBlock(as, "routes", route, x.name);
		await stack.commit(as, "routes", route, "with the block");
		await stack.setScript(as, "routes", route, "return 2;");
		await stack.release(as, "routes", route);

		expect((await stack.call(as, "DELETE", `/custom-blocks/${x.id}`)).status).toBe(200);
		// checking the old version out later is a compile error, not a crash: it says so
		const list = (await stack.call(as, "GET", `/routes/${route}/versions`)).body.versions;
		expect(list).toHaveLength(2);
	});

	it("is not blocked by a sandbox, which then fails cleanly to compile", async () => {
		const { as, project, userId } = await stack.setup();
		const x = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", x.id, "return 1;");
		await stack.release(as, "custom-blocks", x.id);
		const sandbox = await sandboxUsing(project, userId, x.name);
		await stack.compileBlock(x.id);

		expect((await stack.call(as, "DELETE", `/custom-blocks/${x.id}`)).status).toBe(200);
		expect(await stack.blockArtifact(project, x.id, "development")).toBeNull();
		expect(await stack.blockArtifact(project, x.id, "production")).toBeNull();

		// recompiling the sandbox must not throw: it records why it cannot compile
		const { compileSandbox } = await import("../../compiler/sandbox");
		await compileSandbox(sandbox);
		const [log] = await stack.sql`SELECT level, message, detail FROM system_logs
			WHERE resource_id = ${sandbox} AND resource_type = 'sandbox' AND type = 'compile'`;
		
		expect(log.level).toBe("error");
		expect(log.message).toContain(x.name);
		expect(log.detail.status).toBe("failed");
	});
});

describe("a canvas that names a block that is gone", () => {
	it("fails to compile with a log for a route and a workflow, and takes nothing else down", async () => {
		const { as, project } = await stack.setup();
		const kept = await stack.createRoute(as);
		await stack.setScript(as, "routes", kept, "return 1;");
		const route = await stack.createRoute(as);
		await stack.setScript(as, "routes", route, "return 1;");
		const workflow = await stack.createWorkflow(as);
		await stack.setScript(as, "workflows", workflow, "return 1;");
		// the delete guard keeps this from happening through the API, so the name is put there directly
		await stack.sql`UPDATE blocks SET type = 'user_defined.project.gone'
			WHERE type = 'jsrunner' AND (route_id = ${route} OR workflow_id = ${workflow})`;

		const { compileWorkflow } = await import("../../compiler/service");
		await stack.compileRoute(route);
		await compileWorkflow(workflow);
		await stack.compileRoute(kept);

		const logs = await stack.sql`SELECT resource_id, level, message, detail FROM system_logs
			WHERE project_id = ${project} AND type = 'compile'`;
		const by = (id: string) => logs.find((l: { resource_id: string }) => l.resource_id === id);
		expect(by(route)).toMatchObject({ level: "error", detail: { status: "failed" } });
		expect(by(route).message).toContain("user_defined.project.gone");
		expect(by(workflow)).toMatchObject({ level: "error", detail: { status: "failed" } });
		expect(by(kept)).toMatchObject({ level: "info", detail: { status: "compiled" } });
		expect((await stack.routeArtifact(project, kept, "development"))?.source).toContain("= (1);");
	});
});

describe("deleting a middleware", () => {
	it("is refused while a route attaches it in a working copy or a promoted version", async () => {
		const { as } = await stack.setup();
		const mw = await stack.createMiddleware(as, []);
		await stack.release(as, "middlewares", mw.id);
		const route = await stack.createRoute(as);
		await stack.setScript(as, "routes", route, "return 1;");
		await stack.call(as, "PUT", `/routes/${route}/middlewares`, { before: [mw.id], after: [] });

		const working = await stack.call(as, "DELETE", `/middlewares/${mw.id}`);
		expect(working.status).toBe(409);
		expect(working.body.references).toEqual([
			expect.objectContaining({ kind: "route", id: route, inWorkingCopy: true }),
		]);

		await stack.release(as, "routes", route);
		await stack.call(as, "PUT", `/routes/${route}/middlewares`, { before: [], after: [] });
		const promoted = await stack.call(as, "DELETE", `/middlewares/${mw.id}`);
		expect(promoted.status).toBe(409);
		expect(promoted.body.references[0]).toMatchObject({ id: route, inProduction: true, inWorkingCopy: false });

		// promoted without it, the old version no longer counts
		await stack.release(as, "routes", route);
		expect((await stack.call(as, "DELETE", `/middlewares/${mw.id}`)).status).toBe(200);
	});
});

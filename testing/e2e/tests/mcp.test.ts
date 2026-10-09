import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	adminCall,
	adminStatus,
	callTool,
	type McpStack,
	mcp,
	startMcpStack,
	stopMcpStack,
} from "../src/mcp";
import { allTools, readRows, uniq, writeRows } from "../src/mcpRows";

const ROLES = ["viewer", "creator", "project_admin"] as const;
const RANK = { viewer: 0, creator: 1, project_admin: 2 };
const ROLE_NAMES = { viewer: "Viewer", creator: "Creator", project_admin: "Project Admin" };

let stack: McpStack;

beforeAll(async () => {
	stack = await startMcpStack();
}, 300_000);

afterAll(stopMcpStack);

describe("MCP role matrix", () => {
	it("has a row for every tool", async () => {
		const tools = new Set([...readRows(stack), ...(await writeRows(stack))].map((r) => r.tool));
		expect([...tools].sort()).toEqual(allTools.map((t) => t.name).sort());
	});

	for (const role of ROLES) {
		it(`${role}: each tool succeeds exactly when the admin API does`, async () => {
			const token = stack.tokens[role];
			for (const row of [...readRows(stack), ...(await writeRows(stack))]) {
				const needs = allTools.find((t) => t.name === row.tool)!.role;
				if (row.deniedOnly && RANK[role] >= RANK[needs]) continue;
				const [status, result] = await Promise.all([
					adminStatus(stack, token, row.api),
					callTool(stack, token, row.tool, row.args),
				]);
				// pinning the expected status keeps the matrix honest: a server that
				// 200s everything would otherwise pass. Writes may answer 201 or 204.
				const got = status < 300 ? "ok" : status;
				expect(`${row.tool} ${got}`).toBe(`${row.tool} ${RANK[role] >= RANK[needs] ? "ok" : 403}`);
				expect(`${row.tool} ok=${result.ok}: ${result.text.slice(0, 200)}`).toStartWith(
					`${row.tool} ok=${status < 300}`,
				);
				if (status === 403) {
					expect(result.text).toBe(`You need the ${ROLE_NAMES[needs]} role in this project.`);
				}
			}
		});
	}

	it("trims a get to what the model needs", async () => {
		const { text } = await callTool(stack, stack.tokens.creator, "get_route", {
			routeId: stack.ids.route,
		});
		expect(JSON.parse(text)).toEqual({
			id: stack.ids.route,
			name: "hello",
			method: "GET",
			path: "/hello",
			active: true,
			timeoutSeconds: 30,
			tracingEnabled: false,
			recordExecution: false,
			acceptedContentTypes: expect.any(Array),
			bodySchema: null,
			querySchema: null,
			paramsSchema: null,
			middlewares: { before: [], after: [] },
		});
	});
});

describe("MCP writes", () => {
	const call = async (tool: string, args: object) => {
		const r = await callTool(stack, stack.tokens.creator, tool, args);
		if (!r.ok) throw new Error(`${tool}: ${r.text}`);
		return JSON.parse(r.text);
	};

	it("creates, updates and deletes a middleware", async () => {
		const name = uniq("rt-");
		const { id } = await call("save_middleware", { projectId: stack.projectId, name });
		expect((await call("get_middleware", { middlewareId: id })).name).toBe(name);

		await call("save_middleware", { middlewareId: id, name: `${name}-2`, description: "renamed" });
		expect(await call("get_middleware", { middlewareId: id })).toEqual({
			id,
			name: `${name}-2`,
			description: "renamed",
			blocks: [],
		});

		expect(await call("delete_middleware", { middlewareId: id })).toEqual({ deleted: id });
		const gone = await callTool(stack, stack.tokens.creator, "get_middleware", { middlewareId: id });
		expect(gone.ok).toBe(false);
		expect(gone.text).toStartWith("Not found");
	});

	it("never echoes a secret back", async () => {
		const p = stack.projectId;
		const secret = "s3cret-value-for-mcp";
		const created = await call("save_app_config", {
			projectId: p,
			keyName: uniq("API_KEY_"),
			value: secret,
			description: "",
			isEncrypted: true,
			encodingType: "plaintext",
		});
		expect(Object.keys(created)).toEqual(["id"]);
		const updated = await call("save_app_config", {
			projectId: p,
			appConfigId: created.id,
			value: secret,
		});
		expect(updated).toEqual({ id: created.id });
		const read = await call("get_app_config", { projectId: p, appConfigId: created.id });
		expect(read.value).not.toContain(secret);
		expect(read.isEncrypted).toBe(true);
	});

	it("a connection test really connects", async () => {
		const result = await call("test_integration_connection", {
			projectId: stack.projectId,
			integrationId: stack.ids.integration,
		});
		expect(result).toMatchObject({ success: true });
	});

	// #672: an agent could not add GET next to PUT and DELETE on one path
	it("allows every method on one path, and says why a clash is refused", async () => {
		const base = `/${uniq("users-")}`;
		const paramsSchema = { dataType: "object", properties: [{ key: "id", dataType: "str", required: true }] };
		const save = (method: string, path: string, name = uniq("r-")) =>
			callTool(stack, stack.tokens.creator, "save_route", {
				projectId: stack.projectId,
				name,
				method,
				path,
				paramsSchema: { ...paramsSchema, properties: [{ ...paramsSchema.properties[0], key: path.split(":")[1] }] },
			});
		for (const method of ["PUT", "DELETE", "GET"]) {
			const r = await save(method, `${base}/:id`, `${base.slice(1)}-${method}`);
			expect(`${method} ${r.ok}: ${r.text}`).toStartWith(`${method} true`);
		}
		const sameShape = await save("GET", `${base}/:userId`);
		expect(sameShape.ok).toBe(false);
		expect(sameShape.text).toContain(`GET ${base}/:id is already taken by route "${base.slice(1)}-GET"`);
		const sameName = await save("POST", `${base}/:id`, `${base.slice(1)}-GET`);
		expect(sameName.text).toContain(`A route named "${base.slice(1)}-GET" already exists in this project`);
	});
});

describe("MCP runs", () => {
	const call = async (tool: string, args: object) => {
		const r = await callTool(stack, stack.tokens.creator, tool, args);
		if (!r.ok) throw new Error(`${tool}: ${r.text}`);
		return JSON.parse(r.text);
	};

	it("builds a route canvas with edit_canvas, turns it on and calls it for real", async () => {
		const name = uniq("echo-");
		const { id } = await call("save_route", {
			projectId: stack.projectId,
			name,
			path: `/${name}/:who`,
			method: "POST",
			paramsSchema: { dataType: "object", properties: [{ key: "who", dataType: "str", required: true }] },
		});
		const target = { kind: "route", id };
		const canvas = await call("get_canvas", { target });
		expect(canvas.blocks[0]).not.toHaveProperty("position");
		const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
		const response = canvas.blocks.find((b: any) => b.type === "response").id;
		const fromEntry = canvas.edges.filter((e: any) => e.from === entry);
		const edited = await call("edit_canvas", {
			target,
			version: canvas.version,
			ops: [
				...fromEntry.map((e: any) => ({ op: "disconnect", from: entry, to: e.to })),
				{
					op: "add_block",
					ref: "block_1",
					type: "jsRunner",
					data: { value: 'return { hello: "mcp", who: getRouteParam("who") };' },
					connect_from: { from: entry },
				},
				{ op: "update_block", id: response, data: { httpCode: "201" } },
				{ op: "connect", from: "block_1", to: response },
			],
		});
		expect(edited).toEqual({ version: canvas.version + 1, refs: { block_1: expect.any(String) } });
		const after = await call("get_canvas", { target });
		expect(after.edges).toEqual(
			expect.arrayContaining([
				{ from: entry, to: edited.refs.block_1, handle: "source" },
				{ from: edited.refs.block_1, to: response, handle: "source" },
			]),
		);

		// a new route is off until it is turned on
		await call("save_route", { routeId: id, active: true });

		const schemas = await call("get_route", { routeId: id });
		expect(schemas.paramsSchema.properties[0]).toMatchObject({ key: "who", dataType: "str" });

		// the save compiles and reaches the worker a moment later
		let result: any;
		for (let i = 0; i < 80; i++) {
			result = await call("call_route", { routeId: id, params: { who: "ai" }, body: { n: 1 } });
			if (result.status === 201) break;
			await Bun.sleep(250);
		}
		expect(result).toMatchObject({ status: 201, body: { hello: "mcp", who: "ai" } });

		const bad = await callTool(stack, stack.tokens.creator, "save_route", {
			routeId: id,
			paramsSchema: { type: "object" },
		});
		expect(bad.text).toContain("paramsSchema");

		const missing = await callTool(stack, stack.tokens.creator, "call_route", { routeId: id });
		expect(missing.text).toBe('Invalid input: Missing path param "who"');
	});

	it("call_route shows the block and real error of a failing route (#671)", async () => {
		const name = uniq("dbg-");
		const { id } = await call("save_route", {
			projectId: stack.projectId,
			name,
			path: `/${name}`,
			method: "GET",
			active: true,
		});
		const canvas = await call("get_canvas", { target: { kind: "route", id } });
		const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
		await call("edit_canvas", {
			target: { kind: "route", id },
			version: canvas.version,
			ops: [
				{
					op: "add_block",
					ref: "js",
					type: "jsRunner",
					data: { value: "throw new Error('boom', { cause: new Error('the real reason') });" },
					connect_from: { from: entry },
				},
			],
		});
		// the save compiles and reaches the worker a moment later
		let result: any;
		for (let i = 0; i < 80; i++) {
			result = await call("call_route", { routeId: id });
			if (result.error?.message === "boom") break;
			await Bun.sleep(250);
		}
		expect(result.status).toBe(500);
		expect(result.error).toMatchObject({
			block: { type: "jsrunner" },
			message: "boom",
			detail: "Error: the real reason",
		});
		expect(result.error.stack).toContain("fluxify-graph");
	});

	it("records a route call and reads its spans back", async () => {
		const name = uniq("rec-");
		const { id } = await call("save_route", {
			projectId: stack.projectId,
			name,
			path: `/${name}`,
			method: "GET",
			active: true,
			recordExecution: true,
		});
		expect((await call("get_route", { routeId: id })).recordExecution).toBe(true);
		// a new route's starter blocks are not connected: the Response block never
		// runs until something leads to it
		const canvas = await call("get_canvas", { target: { kind: "route", id } });
		const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
		const response = canvas.blocks.find((b: any) => b.type === "response").id;
		await call("edit_canvas", {
			target: { kind: "route", id },
			version: canvas.version,
			ops: [
				{
					op: "add_block",
					ref: "js",
					type: "jsRunner",
					data: { value: 'return { hi: "rec" };' },
					connect_from: { from: entry },
				},
				{ op: "connect", from: "js", to: response },
			],
		});
		// the save compiles and reaches the worker a moment later
		for (let i = 0; i < 80; i++) {
			if ((await call("call_route", { routeId: id })).body?.hi === "rec") break;
			await Bun.sleep(250);
		}
		const target = { projectId: stack.projectId, kind: "route", targetId: id };
		// the run reaches Postgres through a queue, a moment after the response;
		// a call that beat the canvas edit is recorded too, so wait for the full one
		let recorded: any;
		for (let i = 0; i < 80 && !recorded; i++) {
			const list = await call("list_recordings", target);
			recorded = list.items.find((r: any) => r.spanCount >= 3);
			if (!recorded) await Bun.sleep(250);
		}
		expect(recorded).toMatchObject({ outcome: "success", statusCode: 200 });

		const run = await call("get_recording", { ...target, runId: recorded.id });
		expect(run.spans.map((s: any) => s.blockType)).toEqual(
			expect.arrayContaining(["entrypoint", "jsrunner", "response"]),
		);
		expect(run.spans[0]).not.toHaveProperty("input");
		const span = async (type: string) =>
			call("get_recording", {
				...target,
				runId: run.id,
				spanSeq: run.spans.find((s: any) => s.blockType === type).seq,
			});
		expect((await span("entrypoint")).input).toMatchObject({ method: "GET" });
		const reply = await span("response");
		expect(reply).toMatchObject({ outcome: "success", input: { hi: "rec" } });
		expect(reply).toHaveProperty("output");
	});

	it("viewers get 403, not 404, saving a workflow canvas", async () => {
		const res = await adminCall(stack, stack.tokens.viewer, {
			method: "PUT",
			path: `/v1/workflows/${stack.ids.workflow}/save-canvas`,
			body: { actionsToPerform: { blocks: [], edges: [] }, changes: { blocks: [], edges: [] } },
		});
		expect(res.status).toBe(403);
	});
});

describe("MCP canvas edits", () => {
	const call = async (tool: string, args: object) => {
		const r = await callTool(stack, stack.tokens.creator, tool, args);
		if (!r.ok) throw new Error(`${tool}: ${r.text}`);
		return JSON.parse(r.text);
	};
	const newWorkflow = async () => {
		const { id } = await call("save_workflow", { projectId: stack.projectId, name: uniq("cv-") });
		const target = { kind: "workflow", id };
		return { target, canvas: await call("get_canvas", { target }) };
	};

	it("refuses a stale version and saves nothing", async () => {
		const { target, canvas } = await newWorkflow();
		const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
		const add = { op: "add_block", ref: "b", type: "consolelog", data: { value: "hi" }, connect_from: { from: entry } };
		await call("edit_canvas", { target, version: canvas.version, ops: [add] });
		const stale = await callTool(stack, stack.tokens.creator, "edit_canvas", {
			target,
			version: canvas.version,
			ops: [{ ...add, ref: "c" }],
		});
		expect(stale.ok).toBe(false);
		expect(stale.text).toContain("Read it again with get_canvas");
		// the server refuses it too, for any writer that sends the version
		const direct = await adminCall(stack, stack.tokens.creator, {
			method: "PUT",
			path: `/v1/workflows/${target.id}/save-canvas?expectedVersion=${canvas.version}`,
			body: { actionsToPerform: { blocks: [], edges: [] }, changes: { blocks: [], edges: [] } },
		});
		expect(direct.status).toBe(409);
		const now = await call("get_canvas", { target });
		expect(now.version).toBe(canvas.version + 1);
		expect(now.blocks).toHaveLength(canvas.blocks.length + 1);
	});

	it("validate with no ops returns the issues and saves nothing", async () => {
		const { target, canvas } = await newWorkflow();
		const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
		// a Response block in a workflow is a warning: it still saves
		const saved = await call("edit_canvas", {
			target,
			version: canvas.version,
			ops: [{ op: "add_block", ref: "r", type: "response", data: { httpCode: "200" }, connect_from: { from: entry } }],
			validate: true,
		});
		expect(saved.issues).toEqual([expect.objectContaining({ severity: "warning", blockId: saved.refs.r })]);

		const checked = await call("edit_canvas", { target, version: saved.version, ops: [], validate: true });
		expect(checked).toEqual({ version: saved.version, issues: saved.issues });
		expect((await call("get_canvas", { target })).version).toBe(saved.version);
	});

	it("drops fields a block does not have, warns, and keeps free-form ones (#703)", async () => {
		const { target, canvas } = await newWorkflow();
		const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
		const handlerId = canvas.blocks.find((b: any) => b.type === "error_handler").id;
		const saved = await call("edit_canvas", {
			target,
			version: canvas.version,
			ops: [
				{ op: "update_block", id: handlerId, data: { statusCode: 500, transform: "return 1;" } },
				{
					op: "add_block",
					ref: "req",
					type: "httprequest",
					data: { url: "https://x.test", method: "POST", headers: { "X-Any": "1" }, body: { a: [1] } },
					connect_from: { from: entry },
				},
			],
			validate: true,
		});
		expect(saved.issues).toContainEqual(
			expect.objectContaining({
				severity: "warning",
				blockId: handlerId,
				message: expect.stringContaining("removed unknown field(s) statusCode, transform"),
			}),
		);
		const stored = (await call("get_canvas", { target })).blocks;
		const handler = stored.find((b: any) => b.id === handlerId);
		expect(handler.data).not.toHaveProperty("statusCode");
		expect(handler.data).not.toHaveProperty("transform");
		const request = stored.find((b: any) => b.id === saved.refs.req);
		expect(request.data).toMatchObject({ headers: { "X-Any": "1" }, body: { a: [1] } });
	});

	it("refuses a bad op readably and saves nothing", async () => {
		const { target, canvas } = await newWorkflow();
		const bad = await callTool(stack, stack.tokens.creator, "edit_canvas", {
			target,
			version: canvas.version,
			ops: [{ op: "connect", from: "nope", to: "also-nope" }],
		});
		expect(bad).toEqual({ ok: false, text: expect.stringContaining('no block "nope"') });
		const unknown = await callTool(stack, stack.tokens.creator, "edit_canvas", {
			target,
			version: canvas.version,
			ops: [{ op: "add_block", ref: "x", type: "not_a_block" }],
		});
		expect(unknown.text).toContain("Unknown block type");
		expect((await call("get_canvas", { target })).version).toBe(canvas.version);
	});
});

describe("MCP tests and project admin", () => {
	const callAs = async (role: "creator" | "project_admin", tool: string, args: object) => {
		const r = await callTool(stack, stack.tokens[role], tool, args);
		if (!r.ok) throw new Error(`${tool}: ${r.text}`);
		return JSON.parse(r.text);
	};

	it("runs a seeded test suite and reads the run back", async () => {
		const testSuiteId = stack.ids.testSuite;
		const started = await callAs("creator", "run_test_suite", { testSuiteId });
		expect(started.runId).toEqual(expect.any(String));
		let run: any;
		for (let i = 0; i < 120; i++) {
			const runs = await callAs("creator", "get_test_runs", { testSuiteId });
			run = runs.find((r: any) => r.runId === started.runId);
			if (run && !["queued", "running"].includes(run.status)) break;
			await Bun.sleep(500);
		}
		expect(run.status).toBeOneOf(["passed", "failed", "error", "timeout"]);
		expect(run.suites).toEqual([
			expect.objectContaining({ testSuiteId, status: run.status, cases: expect.any(Array) }),
		]);
	});

	it("adds a member by email, changes their role and removes them", async () => {
		const p = stack.projectId;
		const user = stack.users[2];
		const roleOf = async () =>
			(await callAs("creator", "list_members", { projectId: p })).items.find(
				(m: any) => m.userId === user.id,
			)?.role;

		expect(await callAs("project_admin", "add_member", { projectId: p, user: user.email, role: "viewer" })).toEqual({
			userId: user.id,
			role: "viewer",
		});
		expect(await roleOf()).toBe("viewer");
		await callAs("project_admin", "update_member_role", { projectId: p, userId: user.id, role: "creator" });
		expect(await roleOf()).toBe("creator");
		await callAs("project_admin", "remove_member", { projectId: p, userId: user.id });
		expect(await roleOf()).toBeUndefined();
	});

	it("updates the project's plain settings", async () => {
		const p = stack.projectId;
		await callAs("project_admin", "update_project", { projectId: p, description: "orders api" });
		expect((await callAs("creator", "get_project", { projectId: p })).description).toBe("orders api");
	});
});

describe("MCP isolation", () => {
	it("two clients calling at once each see only their own projects", async () => {
		const listAs = async (token: string) => {
			const { text } = await callTool(stack, token, "list_projects", {});
			return JSON.parse(text).items.map((p: { id: string }) => p.id);
		};
		const calls = Array.from({ length: 5 }, () => [
			listAs(stack.tokens.viewer),
			listAs(stack.tokens.other),
		]).flat();
		const results = await Promise.all(calls);
		results.forEach((ids, i) => {
			expect(ids).toEqual([i % 2 === 0 ? stack.projectId : stack.otherProjectId]);
		});
	});

	it("each client's whoami is its own user", async () => {
		const [a, b] = await Promise.all(
			[stack.tokens.viewer, stack.tokens.other].map(async (token) => {
				const r = await mcp(stack, token, "tools/call", { name: "whoami", arguments: {} });
				return JSON.parse(r.content[0].text).acl;
			}),
		);
		expect(a).toEqual([{ projectId: stack.projectId, role: "viewer" }]);
		expect(b).toEqual([{ projectId: stack.otherProjectId, role: "viewer" }]);
	});
});

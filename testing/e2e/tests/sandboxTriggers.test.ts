import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createRedisClient } from "@fluxify/adapters";
import { connectNats, type KvBucket, openKvBucket } from "@fluxify/common/nats";
import { api, type EnvStack, mcpTool, startEnvStack, stopEnvStack } from "../src/envs";

// Triggers on a sandbox, and the sandbox MCP tools (#735), the real thing: an
// admin, NATS, a production and a development compiled worker, and the admin's
// own Redis as the queue. A Redis Streams trigger attached to a sandbox runs it
// on the development worker with development values; production never holds
// the trigger; every run is recorded; deleting the sandbox stops it.

let stack: EnvStack;
let redis: ReturnType<typeof createRedisClient>;
let buckets: Record<"production" | "development", KvBucket<unknown>>;
const PROJECT = () => stack.projectId;
const SANDBOXES = () => `/v1/projects/${PROJECT()}/sandboxes`;

beforeAll(async () => {
	stack = await startEnvStack();
	redis = createRedisClient({ source: "credentials", host: "127.0.0.1", port: String(stack.redisPort) } as never);
	redis.on("error", () => undefined);
	const nc = await connectNats({ ...stack.nats, connectionName: "e2e-buckets" } as never);
	buckets = {
		production: await openKvBucket(nc, "fluxify_artifacts", { history: 1 }),
		development: await openKvBucket(nc, "fluxify_dev_artifacts", { history: 1 }),
	};
}, 600_000);

afterAll(async () => {
	redis?.disconnect();
	await stopEnvStack();
});

async function until<T>(what: string, probe: () => Promise<T | false>, ms = 60_000): Promise<T> {
	const deadline = Date.now() + ms;
	let last: unknown;
	while (Date.now() < deadline) {
		try {
			const value = await probe();
			if (value) return value;
		} catch (error) {
			last = error;
		}
		await Bun.sleep(300);
	}
	throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`);
}

async function ok(call: Promise<{ status: number; body: any }>) {
	const { status, body } = await call;
	if (status >= 300) throw new Error(`${status} ${JSON.stringify(body)}`);
	return body;
}

/** A sandbox whose one JS block hands back what started it. */
async function newSandbox(name: string, code: string) {
	const { id } = await ok(api(stack, "creator", SANDBOXES(), { body: { name } }));
	const canvas = await ok(api(stack, "creator", `${SANDBOXES()}/${id}/canvas-items`));
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const [js, reply] = [Bun.randomUUIDv7(), Bun.randomUUIDv7()];
	const edges = [
		{ id: Bun.randomUUIDv7(), from: entry, to: js, fromHandle: "source", toHandle: "source" },
		{ id: Bun.randomUUIDv7(), from: js, to: reply, fromHandle: "source", toHandle: "source" },
	];
	const blocks = [
		{ id: js, type: "jsrunner", position: { x: 240, y: 0 }, data: { value: code } },
		{ id: reply, type: "response", position: { x: 480, y: 0 }, data: { httpCode: "200" } },
	];
	await ok(
		api(stack, "creator", `${SANDBOXES()}/${id}/save-canvas`, {
			method: "PUT",
			body: {
				actionsToPerform: {
					blocks: blocks.map((b) => ({ id: b.id, action: "upsert" })),
					edges: edges.map((e) => ({ id: e.id, action: "upsert" })),
				},
				changes: { blocks, edges },
			},
		}),
	);
	return id as string;
}

const runsOf = async (id: string) => {
	const list = await ok(api(stack, "creator", `${SANDBOXES()}/${id}/runs?perPage=50`));
	return Promise.all(list.data.map((run: any) => ok(api(stack, "creator", `${SANDBOXES()}/${id}/runs/${run.id}`))));
};
const outputs = (runs: any[]) =>
	runs.flatMap((run) => run.spans.filter((s: any) => s.blockType === "jsrunner").map((s: any) => s.output));

describe("a queue trigger on a sandbox", () => {
	const stream = `sbx-orders-${Date.now()}`;
	let box: string;
	let trigger: string;
	const key = () => `trigger.${PROJECT()}.${trigger}`;

	beforeAll(async () => {
		// production points at nothing: only development's values can ever read the stream
		const { id: integration } = await ok(
			api(stack, "creator", `/v1/${PROJECT()}/integrations`, {
				body: {
					name: "queue_kv",
					group: "kv",
					variant: "Redis",
					config: { source: "credentials", host: "127.0.0.1", port: "1" },
					devConfig: { source: "credentials", host: "127.0.0.1", port: String(stack.redisPort) },
				},
			}),
		);
		await redis.xgroup("CREATE", stream, `fluxify-probe-${Date.now()}`, "$", "MKSTREAM");
		box = await newSandbox("orders", "return { got: trigger.data.map(function (e) { return e.data; }) };");
		trigger = (
			await ok(
				api(stack, "creator", "/v1/triggers", {
					body: {
						projectId: PROJECT(),
						name: "orders",
						type: "redis",
						integrationId: integration,
						source: { stream },
						sandboxId: box,
						active: true,
					},
				}),
			)
		).id;
	}, 120_000);

	it("is held by development only", async () => {
		await until("the development bucket to hold it", async () => Boolean(await buckets.development.get(key())));
		expect(await buckets.development.get(key())).toMatchObject({ workflowId: box, type: "redis" });
		expect(await buckets.production.get(key())).toBeNull();
	});

	it("runs the sandbox on the development worker for every entry, and records each run", async () => {
		// the consumer group may start just after the artifact lands
		await until("a first run", async () => {
			await redis.xadd(stream, "*", "id", "warmup");
			return (await runsOf(box)).length > 0;
		});
		await redis.xadd(stream, "*", "id", "1", "status", "paid");
		await redis.xadd(stream, "*", "id", "2", "status", "new");
		const runs = await until("both entries to be recorded", async () => {
			const all = await runsOf(box);
			const ids = outputs(all).flatMap((o: any) => o.got.map((d: any) => d.id));
			return ids.includes("1") && ids.includes("2") && all;
		});
		for (const run of runs) {
			expect(run.outcome).toBe("success");
			expect(run.workflowVersion).toBeTruthy();
		}
		expect(outputs(runs).flatMap((o: any) => o.got)).toContainEqual({ id: "1", status: "paid" });
	});

	it("is not visible to another creator in the project", async () => {
		expect((await api(stack, "other", `/v1/triggers/${trigger}`)).status).toBe(404);
		const listed = await ok(api(stack, "other", `/v1/triggers/list?projectId=${PROJECT()}`));
		expect(listed.data.map((t: any) => t.id)).not.toContain(trigger);
	});

	it("stops once the sandbox is deleted", async () => {
		await ok(api(stack, "creator", `${SANDBOXES()}/${box}`, { method: "DELETE" }));
		await until("the trigger to leave the development bucket", async () => !(await buckets.development.get(key())));
		// the worker drops its consumer when its bucket watch sees the delete, a beat after the bucket is empty
		await Bun.sleep(3_000);
		const id = await redis.xadd(stream, "*", "id", "after");
		await Bun.sleep(3_000);
		// nobody in the trigger's group read it
		const groups = ((await redis.xinfo("GROUPS", stream)) as string[][]).map((g) =>
			Object.fromEntries(g.flatMap((v, i) => (i % 2 ? [] : [[v, g[i + 1]]]))),
		);
		const group = groups.find((g) => g.name === `fluxify-${trigger}`);
		expect(group).toBeDefined();
		expect(group!["last-delivered-id"]).not.toBe(id);
	}, 60_000);
});

describe("MCP sandbox tools", () => {
	let box: string;

	beforeAll(async () => {
		const created = await mcpTool(stack, stack.tokens.creator, "create_sandbox", {
			projectId: PROJECT(),
			name: "peek",
		});
		box = JSON.parse(created.text).id;
	});

	const target = () => ({ kind: "sandbox", id: box, projectId: PROJECT() });

	it("edits the owner's sandbox canvas, and refuses everyone else's with a 404", async () => {
		const read = JSON.parse((await mcpTool(stack, stack.tokens.creator, "get_canvas", { target: target() })).text);
		const entry = read.blocks.find((b: any) => b.type === "entrypoint").key;
		const edit = await mcpTool(stack, stack.tokens.creator, "edit_canvas", {
			target: target(),
			revision: read.revision,
			ops: [
				{
					op: "add_block",
					ref: "echo",
					type: "jsrunner",
					data: { value: "return { path: httpRequestRoute, got: getRequestBody() };" },
					connect_from: { from: entry },
				},
				{ op: "add_block", ref: "reply", type: "response", data: { httpCode: "200" }, connect_from: { from: "echo" } },
			],
		});
		expect(edit.ok).toBe(true);

		for (const [name, args] of [
			["get_sandbox", { projectId: PROJECT(), sandboxId: box }],
			["get_canvas", { target: target() }],
			["edit_canvas", { target: target(), revision: 0, ops: [] }],
			["call_sandbox", { projectId: PROJECT(), sandboxId: box }],
			["run_sandbox", { projectId: PROJECT(), sandboxId: box }],
			["delete_sandbox", { projectId: PROJECT(), sandboxId: box }],
		] as const) {
			const res = await mcpTool(stack, stack.tokens.other, name, args);
			expect(`${name} ${res.ok}`).toBe(`${name} false`);
			expect(res.text).toContain("Not found");
		}
		const theirs = JSON.parse(
			(await mcpTool(stack, stack.tokens.other, "list_sandboxes", { projectId: PROJECT() })).text,
		);
		expect(theirs).toEqual([]);
	});

	it("call_sandbox reaches the development worker with the token added server side, and never returns it", async () => {
		const { token } = await ok(api(stack, "creator", `/v1/projects/${PROJECT()}/settings/dev-token`));
		const result = await until("the sandbox to answer", async () => {
			const res = await mcpTool(stack, stack.tokens.creator, "call_sandbox", {
				projectId: PROJECT(),
				sandboxId: box,
				method: "POST",
				path: "/peek",
				body: { a: 1 },
			});
			const parsed = JSON.parse(res.text);
			return parsed.status === 200 && parsed.body?.path === "/peek" && { text: res.text, parsed };
		});
		expect(result.parsed.body).toEqual({ path: "/peek", got: { a: 1 } });
		expect(result.text).not.toContain(token);
		expect(result.parsed.runId).toBeString();
		const run = await until("the call to be recorded", async () =>
			ok(api(stack, "creator", `${SANDBOXES()}/${box}/runs/${result.parsed.runId}`)),
		);
		expect(JSON.stringify(run)).not.toContain(token);
	});

	it("run_sandbox queues it as a workflow", async () => {
		const res = JSON.parse(
			(await mcpTool(stack, stack.tokens.creator, "run_sandbox", { projectId: PROJECT(), sandboxId: box })).text,
		);
		expect(res).toMatchObject({ accepted: true, id: expect.any(String) });
	});
});

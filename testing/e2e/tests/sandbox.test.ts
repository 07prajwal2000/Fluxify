import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withCustomBlockPrefix } from "@fluxify/lib";
import { api, type EnvStack, startEnvStack, stopEnvStack } from "../src/envs";

// Sandboxes (#735), the real thing: an admin compiles a sandbox into the
// development bucket only, a development worker serves it at
// `/_sandbox/<id>/*` behind the project's development token, a production
// worker never does, Run queues it as a workflow, and every run is recorded.

let stack: EnvStack;
let token: string;
const PROJECT = () => stack.projectId;
const SANDBOXES = () => `/v1/projects/${PROJECT()}/sandboxes`;
const TOKEN_HEADER = "x-fluxify-dev-token";

beforeAll(async () => {
	stack = await startEnvStack();
	// read first: the first read makes the token and publishes its hash to development
	token = (await ok(api(stack, "creator", `/v1/projects/${PROJECT()}/settings/dev-token`))).token;
}, 600_000);

afterAll(stopEnvStack);

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

type Block = { id: string; type: string; data: object };

/** Saves `blocks` onto a canvas as one chain hanging off its entrypoint. */
async function chain(canvasPath: string, blocks: Block[]) {
	const canvas = await ok(api(stack, "creator", `${canvasPath}/canvas-items`));
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const ids = [entry, ...blocks.map((b) => b.id)];
	const edges = ids.slice(1).map((to, i) => ({
		id: Bun.randomUUIDv7(),
		from: ids[i]!,
		to,
		fromHandle: "source",
		toHandle: "source",
	}));
	// a re-save keeps the edges it already has
	const fresh = edges.filter(
		(e) => !canvas.edges.some((old: any) => old.from === e.from && old.to === e.to),
	);
	await ok(
		api(stack, "creator", `${canvasPath}/save-canvas`, {
			method: "PUT",
			body: {
				actionsToPerform: {
					blocks: blocks.map((b) => ({ id: b.id, action: "upsert" })),
					edges: fresh.map((e) => ({ id: e.id, action: "upsert" })),
				},
				changes: {
					blocks: blocks.map((b, i) => ({ ...b, position: { x: 240 * (i + 1), y: 0 } })),
					edges: fresh,
				},
			},
		}),
	);
}

const js = (id: string, value: string): Block => ({ id, type: "jsrunner", data: { value } });
const reply = (id: string): Block => ({ id, type: "response", data: { httpCode: "200" } });

/**
 * What a sandbox's blocks see of the request that started them. Not `body`: a
 * response block sends an output's `body` key as the whole reply.
 */
const ECHO = "return { method: httpRequestMethod, path: httpRequestRoute, got: getRequestBody() };";

async function newSandbox(name: string, blocks: Block[]) {
	const { id } = await ok(api(stack, "creator", SANDBOXES(), { body: { name } }));
	await chain(`${SANDBOXES()}/${id}`, blocks);
	return id as string;
}

type Call = {
	method?: string;
	body?: string;
	contentType?: string;
	token?: string | null;
};

/** one request to a worker; `token` defaults to the project's real one */
async function hit(worker: "production" | "development", path: string, call: Call = {}) {
	const headers: Record<string, string> = {};
	const sent = call.token === undefined ? token : call.token;
	if (sent !== null) headers[TOKEN_HEADER] = sent;
	if (call.contentType) headers["content-type"] = call.contentType;
	const res = await fetch(`${stack.workers[worker]}${path}`, {
		method: call.method ?? "GET",
		headers,
		body: call.body,
	});
	const text = await res.text();
	let body: any = text;
	try {
		body = JSON.parse(text);
	} catch {}
	return { status: res.status, body };
}

/**
 * Polls until the development worker answers `path` with what `ready` wants.
 * A 200 alone is not enough: a sandbox is compiled on create and again on every
 * save, so its first answer can come from the canvas before the save.
 */
const served = (path: string, ready: (body: any) => boolean = (body) => body?.method === "GET") =>
	until(`the development worker to serve ${path}`, async () => {
		const res = await hit("development", path);
		return res.status === 200 && ready(res.body) && res;
	});

describe("HTTP on a development worker", () => {
	let id: string;

	beforeAll(async () => {
		id = await newSandbox("echo", [js(Bun.randomUUIDv7(), ECHO), reply(Bun.randomUUIDv7())]);
		await served(`/_sandbox/${id}/warmup`);
	}, 120_000);

	it("answers GET with the rest of the path as the request path", async () => {
		const res = await hit("development", `/_sandbox/${id}/anything/deeper?x=1`);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ method: "GET", path: "/anything/deeper" });
	});

	it("answers POST with any body: JSON, text, a form", async () => {
		const asJson = await hit("development", `/_sandbox/${id}/anything`, {
			method: "POST",
			contentType: "application/json",
			body: JSON.stringify({ a: 1, nested: { b: [true] } }),
		});
		expect(asJson.body).toEqual({
			method: "POST",
			path: "/anything",
			got: { a: 1, nested: { b: [true] } },
		});

		const asText = await hit("development", `/_sandbox/${id}/anything`, {
			method: "POST",
			contentType: "text/plain",
			body: "hello",
		});
		expect(asText.body).toMatchObject({ method: "POST", got: "hello" });

		const asForm = await hit("development", `/_sandbox/${id}/anything`, {
			method: "PUT",
			contentType: "application/x-www-form-urlencoded",
			body: "name=ada",
		});
		expect(asForm.body).toMatchObject({ method: "PUT", got: { name: "ada" } });
	});

	it("answers any method", async () => {
		for (const method of ["PATCH", "DELETE"]) {
			const res = await hit("development", `/_sandbox/${id}/x`, { method });
			expect(res.status).toBe(200);
			expect(res.body.method).toBe(method);
		}
	});

	it("refuses a missing or a wrong token with 401", async () => {
		expect((await hit("development", `/_sandbox/${id}/anything`, { token: null })).status).toBe(401);
		const wrong = await hit("development", `/_sandbox/${id}/anything`, { token: "fxd_not-the-token" });
		expect(wrong.status).toBe(401);
	});

	it("is a 404 for a sandbox nobody published", async () => {
		expect((await hit("development", `/_sandbox/${Bun.randomUUIDv7()}/anything`)).status).toBe(404);
	});

	it("is never served by a production worker, token or not", async () => {
		expect((await hit("production", `/_sandbox/${id}/anything`)).status).toBe(404);
		expect((await hit("production", `/_sandbox/${id}/anything`, { token: null })).status).toBe(404);
	});

	it("is gone from the development worker once deleted", async () => {
		const doomed = await newSandbox("doomed", [js(Bun.randomUUIDv7(), "return 1;"), reply(Bun.randomUUIDv7())]);
		await served(`/_sandbox/${doomed}/x`, (body) => body === 1);
		await ok(api(stack, "creator", `${SANDBOXES()}/${doomed}`, { method: "DELETE" }));
		await until("the development worker to drop it", async () => {
			const res = await hit("development", `/_sandbox/${doomed}/x`);
			return res.status === 404 && res;
		});
	});
});

describe("custom blocks", () => {
	it("runs the block's working copy, and picks up an edit without touching the sandbox", async () => {
		const name = `sbx_tag_${crypto.randomUUID().slice(0, 6)}`;
		const block = await ok(
			api(stack, "creator", "/v1/custom-blocks", { body: { projectId: PROJECT(), name, label: "Tag" } }),
		);
		const tagger = Bun.randomUUIDv7();
		await chain(`/v1/custom-blocks/${block.id}`, [js(tagger, "return input + '-v1';")]);

		const { id } = await ok(api(stack, "creator", SANDBOXES(), { body: { name: "custom" } }));
		// the admin learns a new custom block from the block's own save, a moment later
		await until("the custom block to be accepted on the canvas", async () => {
			await chain(`${SANDBOXES()}/${id}`, [
				js(Bun.randomUUIDv7(), "return 'x';"),
				// a custom block's type is its stored, prefixed name
				{ id: Bun.randomUUIDv7(), type: withCustomBlockPrefix(name), data: { invoke: "sync" } },
				reply(Bun.randomUUIDv7()),
			]);
			return true;
		});
		await served(`/_sandbox/${id}/`, (body) => body === "x-v1");

		await chain(`/v1/custom-blocks/${block.id}`, [js(tagger, "return input + '-v2';")]);
		await served(`/_sandbox/${id}/`, (body) => body === "x-v2");
	}, 120_000);
});

describe("Run as workflow, and recordings", () => {
	it("records every run, over HTTP and from Run", async () => {
		const id = await newSandbox("recorded", [js(Bun.randomUUIDv7(), ECHO), reply(Bun.randomUUIDv7())]);
		await served(`/_sandbox/${id}/first`);
		await hit("development", `/_sandbox/${id}/second`, {
			method: "POST",
			contentType: "application/json",
			body: JSON.stringify({ n: 2 }),
		});
		// refused requests run nothing, so they leave nothing
		await hit("development", `/_sandbox/${id}/nope`, { token: null });

		const queued = await ok(
			api(stack, "creator", `${SANDBOXES()}/${id}/run`, { body: { payload: { from: "run" } } }),
		);
		expect(queued.accepted).toBe(true);

		// at least two over HTTP: `served` may have polled more than once
		const runs = await until("the runs to be recorded", async () => {
			const list = await ok(api(stack, "creator", `${SANDBOXES()}/${id}/runs?perPage=50`));
			const details = await Promise.all(
				list.data.map((run: any) => ok(api(stack, "creator", `${SANDBOXES()}/${id}/runs/${run.id}`))),
			);
			const http = details.filter((run) => run.routeVersion).length;
			return http >= 2 && details.some((run) => run.workflowVersion) && details;
		});
		for (const run of runs) {
			expect(run.outcome).toBe("success");
			expect(run.spans.length).toBeGreaterThan(0);
		}
		const workflow = runs.filter((run: any) => run.workflowVersion);
		expect(workflow).toHaveLength(1);
		// the token never reaches a recording
		expect(JSON.stringify(runs)).not.toContain(token);
		const ran = workflow[0].spans.find((span: any) => span.blockType === "jsrunner");
		expect(ran.output.got).toEqual({ from: "run" });
	}, 120_000);
});

import { SQL } from "bun";
import { api, type EnvStack, startEnvStack, stopEnvStack } from "./envs";
import { type GraphFixture, loadGraph, loadWorkflow, type WorkflowFixture } from "./graph";

/**
 * The stack behind the SSE and stop suites: an admin, NATS and Redis, with
 * development routes on one worker process and workflows on another. Graphs are
 * saved through the API and called over HTTP, so what a test sees is what a
 * client sees, and everything between a route and a workflow crosses nodes.
 */

export const LIVENESS_SECONDS = 3;
const TOKEN_HEADER = "x-fluxify-dev-token";

export let stack: EnvStack;
let token: string;
let sink: ReturnType<typeof Bun.serve>;
export let events: string[] = [];
const holds = new Map<string, () => void>();

export async function startStreaming() {
	stack = await startEnvStack({
		splitWorkers: true,
		env: { SSE_LIVENESS_TIMEOUT: String(LIVENESS_SECONDS) },
	});
	token = (await ok(api(stack, "creator", `/v1/projects/${stack.projectId}/settings/dev-token`))).token;
	sink = Bun.serve({
		port: 0,
		idleTimeout: 0,
		fetch(request) {
			const url = new URL(request.url);
			const k = url.searchParams.get("k")!;
			if (url.pathname === "/ev") {
				events.push(`${k} ${url.searchParams.get("e")}`);
				return new Response("ok");
			}
			// answered when the test says so: a run sits here for as long as it needs to
			return new Promise<Response>((resolve) => holds.set(k, () => resolve(new Response("ok"))));
		},
	});
	const sinkUrl = `http://127.0.0.1:${sink.port}`;
	await ok(
		api(stack, "creator", `/v1/${stack.projectId}/app-config`, {
			body: {
				keyName: "E2E_SINK_URL",
				description: "",
				value: sinkUrl,
				devValue: sinkUrl,
				isEncrypted: false,
				encodingType: "plaintext",
			},
		}),
	);
}

export async function stopStreaming() {
	for (const release of holds.values()) release();
	sink?.stop(true);
	await stopEnvStack();
}

export async function ok(call: Promise<{ status: number; body: any }>) {
	const { status, body } = await call;
	if (status >= 300) throw new Error(`${status} ${JSON.stringify(body)}`);
	return body;
}

export async function until<T>(what: string, probe: () => T | false | Promise<T | false>, ms = 20_000): Promise<T> {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await probe();
		if (value) return value;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; saw ${JSON.stringify(events)}`);
		await Bun.sleep(25);
	}
}

export const newKey = () => `k${crypto.randomUUID().slice(0, 12)}`;
export const count = (k: string, event: string) => events.filter((e) => e === `${k} ${event}`).length;
export const saw = (k: string, event: string) => until(`${k} ${event}`, () => count(k, event) > 0);
export const release = (k: string) =>
	until(`${k} to reach the sink`, () => holds.has(k)).then(() => holds.get(k)!());

/** A canvas has one of each, made with it: a fixture's stand in for them. */
const SINGLE_BLOCKS = ["entrypoint", "error_handler"];

/** Saves a fixture over a canvas the API made. */
async function saveCanvas(path: string, fixture: GraphFixture | WorkflowFixture, workflowId?: string) {
	const canvas = await ok(api(stack, "creator", `${path}/canvas-items`));
	const made = (type: string) =>
		SINGLE_BLOCKS.includes(type) && canvas.blocks.find((b: any) => b.type === type)?.id;
	const ids = new Map(fixture.blocks.map((b) => [b.id, made(b.type) || Bun.randomUUIDv7()]));
	const blocks = fixture.blocks
		.filter((b) => !SINGLE_BLOCKS.includes(b.type))
		.map((b) => ({
			...b,
			id: ids.get(b.id)!,
			data: JSON.parse(JSON.stringify(b.data).replaceAll("{{workflow}}", workflowId ?? "")),
		}));
	const edges = fixture.edges.map((e) => ({
		...e,
		id: Bun.randomUUIDv7(),
		from: ids.get(e.from)!,
		to: ids.get(e.to)!,
	}));
	await ok(
		api(stack, "creator", `${path}/save-canvas`, {
			method: "PUT",
			body: {
				actionsToPerform: {
					blocks: [
						...canvas.blocks
							.filter((b: any) => !SINGLE_BLOCKS.includes(b.type))
							.map((b: any) => ({ id: b.id, action: "delete" })),
						...blocks.map((b) => ({ id: b.id, action: "upsert" })),
					],
					edges: [
						...canvas.edges.map((e: any) => ({ id: e.id, action: "delete" })),
						...edges.map((e) => ({ id: e.id, action: "upsert" })),
					],
				},
				changes: { blocks, edges },
			},
		}),
	);
}

/** Creates and saves a workflow from `workflows/<name>.json`. */
export async function installWorkflow(name: string, timeoutSeconds?: number) {
	const fixture = await loadWorkflow(name);
	const { id } = await ok(
		api(stack, "creator", "/v1/workflows", {
			body: { name: `${name}-${newKey()}`, projectId: stack.projectId },
		}),
	);
	// the API's floor is 30 seconds, more than a test should sit through. Saved before
	// the canvas, because saving is what compiles it into the artifact.
	if (timeoutSeconds) {
		const sql = new SQL(stack.adminDb, { max: 1 });
		await sql`UPDATE workflows SET timeout_seconds = ${timeoutSeconds} WHERE id = ${id}`;
		await sql.close();
	}
	await saveCanvas(`/v1/workflows/${id}`, fixture);
	return id as string;
}

/** Creates and saves a route from `graphs/<name>.json`, at its own `path`. */
export async function installRoute(
	name: string,
	path: string,
	options: { workflowId?: string; brokerId?: string } = {},
) {
	const fixture = await loadGraph(name);
	const { id } = await ok(
		api(stack, "creator", "/v1/routes", {
			body: {
				name: path,
				path,
				method: fixture.route.method,
				projectId: stack.projectId,
				...(options.brokerId ? { sseBrokerId: options.brokerId } : {}),
			},
		}),
	);
	await saveCanvas(`/v1/routes/${id}`, fixture, options.workflowId);
	return id as string;
}

/**
 * Waits for what was installed to reach both workers. A run of a workflow its
 * worker has not loaded is acked and skipped, so a test must not fire one early.
 * Artifacts land in order, so a run of one installed last proves the rest.
 */
export async function installed() {
	const workflowId = await installWorkflow("stopTarget");
	const path = `/ready-${newKey()}`;
	await installRoute("sse/fire", path, { workflowId });
	await until(
		"the workers to load the graphs",
		async () => {
			const k = newKey();
			const res = await call(path, { k });
			if (res.status !== 200) return false;
			await until(`${k} to run`, () => count(k, "end") > 0, 1_000).catch(() => {});
			return count(k, "end") > 0;
		},
		60_000,
	);
}

/** One call on the route worker's development path. */
export async function call(path: string, query: Record<string, string> = {}) {
	const res = await fetch(`${stack.workers.development}/_/dev${path}?${new URLSearchParams(query)}`, {
		headers: { [TOKEN_HEADER]: token },
	});
	return { status: res.status, text: await res.text() };
}

/** An EventSource-like client: everything the stream sent so far, and whether it ended. */
export function client(path: string, query: Record<string, string>) {
	const abort = new AbortController();
	const state = { status: 0, text: "", ended: false, abort: () => abort.abort() };
	void (async () => {
		const res = await fetch(`${stack.workers.development}/_/dev${path}?${new URLSearchParams(query)}`, {
			headers: { [TOKEN_HEADER]: token },
			signal: abort.signal,
		});
		state.status = res.status;
		const decoder = new TextDecoder();
		for await (const chunk of res.body!) state.text += decoder.decode(chunk);
	})()
		.catch(() => undefined)
		.finally(() => {
			state.ended = true;
		});
	return state;
}

/** What a client's first event says the stream's handle is. */
export async function handleOf(events: ReturnType<typeof client>) {
	return until("the first event", () => /"handle":"([^"]+)"/.exec(events.text)?.[1] ?? false);
}

/** A workflow's recorded development runs, newest first. */
export async function runsOf(workflowId: string): Promise<{ id: string; outcome: string; spanCount: number }[]> {
	const { data } = await ok(
		api(
			stack,
			"creator",
			`/v1/${stack.projectId}/recordings/workflow/${workflowId}/runs?perPage=50&env=development`,
		),
	);
	return data;
}

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { api, type EnvStack, startEnvStack, stopEnvStack } from "../src/envs";

// The admin reaches development workers only through the proxy (#742). A tiny
// host-router (envStack, at PROXY_URL) stands in for it and routes by Host to
// two development pools, one per subdomain project. Every admin call names the
// project with Host, so it lands on that project's pool — each answer carries
// `x-e2e-pool` (a or b). A token for another project, or the bare host, is a 404.

const POOL_A = "poola";
const TOKEN_HEADER = "x-fluxify-dev-token";

let stack: EnvStack;
const projectA = () => stack.poolProjects!.a;
const projectB = () => stack.poolProjects!.b;

beforeAll(async () => {
	stack = await startEnvStack({ devPools: 2 });
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
const js = (value: string): Block => ({ id: Bun.randomUUIDv7(), type: "jsrunner", data: { value } });
const reply = (): Block => ({ id: Bun.randomUUIDv7(), type: "response", data: { httpCode: "200" } });

/** Saves `blocks` onto a canvas as one chain off its entrypoint, ending in its own response block. */
async function chain(canvasPath: string, blocks: Block[], toResponse = true) {
	const canvas = await ok(api(stack, "creator", `${canvasPath}/canvas-items`));
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const response = canvas.blocks.find((b: any) => b.type === "response")?.id;
	const ids = [entry, ...blocks.map((b) => b.id), ...(toResponse ? [response] : [])];
	const edges = ids.slice(1).map((to, i) => ({
		id: Bun.randomUUIDv7(),
		from: ids[i]!,
		to,
		fromHandle: "source",
		toHandle: "source",
	}));
	await ok(
		api(stack, "creator", `${canvasPath}/save-canvas`, {
			method: "PUT",
			body: {
				actionsToPerform: {
					blocks: blocks.map((b) => ({ id: b.id, action: "upsert" })),
					edges: edges.map((e) => ({ id: e.id, action: "upsert" })),
				},
				changes: {
					blocks: blocks.map((b, i) => ({ ...b, position: { x: 240 * (i + 1), y: 0 } })),
					edges,
				},
			},
		}),
	);
}

const ANSWER = "return { pool: 'js' };";

/** a route whose blocks answer `{ pool: 'js' }`, served on `/_/dev<path>` */
async function newRoute(projectId: string, path: string) {
	const { id } = await ok(
		api(stack, "creator", "/v1/routes", {
			body: { name: path, path, method: "GET", projectId, active: true },
		}),
	);
	await chain(`/v1/routes/${id}`, [js(ANSWER)]);
	return id as string;
}

async function newSandbox(projectId: string, name: string) {
	const { id } = await ok(api(stack, "creator", `/v1/projects/${projectId}/sandboxes`, { body: { name } }));
	// a sandbox canvas has no response block of its own, so add one
	await chain(`/v1/projects/${projectId}/sandboxes/${id}`, [js(ANSWER), reply()], false);
	return id as string;
}

/** waits until a call's answer shows it came from `pool` */
const reached = (what: string, pool: "a" | "b", call: () => Promise<{ status: number; body: any }>) =>
	until(`${what} to reach pool ${pool}`, async () => {
		const res = await call();
		return res.status === 200 && res.body?.headers?.["x-e2e-pool"] === pool && res;
	});

describe("call_route and run_blocks reach the project's pool", () => {
	let routeA: string;
	let routeB: string;

	beforeAll(async () => {
		routeA = await newRoute(projectA(), "/who-a");
		routeB = await newRoute(projectB(), "/who-b");
	}, 120_000);

	it("call_route carries the project's host, so each pool answers", async () => {
		const a = await reached("call_route A", "a", () =>
			api(stack, "creator", `/v1/routes/${routeA}/call`, { body: {} }),
		);
		expect(a.body.body).toEqual({ pool: "js" });
		const b = await reached("call_route B", "b", () =>
			api(stack, "creator", `/v1/routes/${routeB}/call`, { body: {} }),
		);
		expect(b.body.body).toEqual({ pool: "js" });
	});

	it("run_blocks (ephemeral) carries the project's host too", async () => {
		const blocks = [
			{ ref: "calc", type: "jsrunner", data: { value: ANSWER } },
			{ ref: "answer", type: "response", data: { httpCode: "200" } },
		];
		const run = (projectId: string) =>
			api(stack, "creator", `/v1/projects/${projectId}/ephemeral-runs`, {
				body: { blocks, edges: [{ from: "calc", to: "answer" }] },
			});
		const a = await reached("run_blocks A", "a", () => run(projectA()));
		expect(a.body.body).toEqual({ pool: "js" });
		const b = await reached("run_blocks B", "b", () => run(projectB()));
		expect(b.body.body).toEqual({ pool: "js" });
	}, 120_000);
});

describe("a sandbox call reaches the project's pool", () => {
	let sandboxA: string;
	let sandboxB: string;

	beforeAll(async () => {
		sandboxA = await newSandbox(projectA(), "proxy-a");
		sandboxB = await newSandbox(projectB(), "proxy-b");
	}, 120_000);

	it("reaches pool A for project A and pool B for project B", async () => {
		const a = await reached("sandbox A", "a", () =>
			api(stack, "creator", `/v1/projects/${projectA()}/sandboxes/${sandboxA}/call`, {
				body: { method: "GET" },
			}),
		);
		expect(a.body.body).toEqual({ pool: "js" });
		const b = await reached("sandbox B", "b", () =>
			api(stack, "creator", `/v1/projects/${projectB()}/sandboxes/${sandboxB}/call`, {
				body: { method: "GET" },
			}),
		);
		expect(b.body.body).toEqual({ pool: "js" });
	}, 120_000);
});

describe("the subdomain rule holds through the proxy", () => {
	let routeId: string;
	let tokenA: string;
	let tokenB: string;

	beforeAll(async () => {
		routeId = await newRoute(projectA(), "/guarded");
		tokenA = (await ok(api(stack, "creator", `/v1/projects/${projectA()}/settings/dev-token`))).token;
		tokenB = (await ok(api(stack, "creator", `/v1/projects/${projectB()}/settings/dev-token`))).token;
	}, 120_000);

	async function hit(subdomain: string | null, token?: string) {
		const headers: Record<string, string> = {};
		if (subdomain) headers.host = `${subdomain}.localhost`;
		if (token) headers[TOKEN_HEADER] = token;
		const res = await fetch(`${stack.proxyUrl}/_/dev/guarded`, { headers });
		const text = await res.text();
		let body: any = text;
		try {
			body = JSON.parse(text);
		} catch {}
		return { status: res.status, body };
	}

	it("answers on the project's subdomain, and refuses another token or the bare host", async () => {
		await until("pool A to serve /_/dev/guarded", async () => {
			const res = await hit(POOL_A, tokenA);
			return res.status === 200 && res.body?.pool === "js" && res;
		});
		expect((await hit(POOL_A, tokenA)).status).toBe(200);
		// a token for the other project, on this project's host: 404
		expect((await hit(POOL_A, tokenB)).status).toBe(404);
		// the bare host is refused for a project that has a subdomain (#742)
		expect((await hit(null, tokenA)).status).toBe(404);
	});
});

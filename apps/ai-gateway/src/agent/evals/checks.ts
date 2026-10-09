import { isDeepStrictEqual } from "node:util";
import type { AdminApi } from "../../mcp/adminApi";

/** What setup and checks get: the task's fresh project, tools acting as the PAT user, and what the agent did. */
export type Ctx = {
	projectId: string;
	/** One MCP tool by name, e.g. tool("list_routes", { projectId }). */
	tool: (name: string, args: Record<string, unknown>) => Promise<any>;
	/** The raw admin API, for what no tool does. */
	api: AdminApi;
	/** Ids setup saved for the checks. */
	seed: Record<string, string>;
	/** Every tool call the agent made, in order. */
	calls: { name: string; input: unknown }[];
	env: Record<string, string | undefined>;
};

export type CheckResult = { pass: boolean; message: string };
export type Check = { name: string; run: (ctx: Ctx) => Promise<CheckResult> };

export type Task = {
	id: string;
	title: string;
	/** Several strings are several user turns of one conversation. */
	prompt: string | string[];
	/** Env vars the task needs; it is skipped with a reason when one is missing. */
	needsEnv?: string[];
	setup?: (ctx: Ctx) => Promise<void>;
	checks: Check[];
	/** Quality items for the judge, scored pass/fail from the conversation. */
	judge: string[];
};

const ok = (message: string): CheckResult => ({ pass: true, message });
const fail = (message: string): CheckResult => ({ pass: false, message });
const short = (v: unknown) => JSON.stringify(v)?.slice(0, 200);

/** Runs a check; a throw is a fail with its message. */
export async function runCheck(check: Check, ctx: Ctx): Promise<CheckResult> {
	try {
		return await check.run(ctx);
	} catch (e) {
		return fail(e instanceof Error ? e.message : String(e));
	}
}

/** `expected`'s keys hold the same values in `actual`; arrays must match in full. */
export function matches(actual: unknown, expected: unknown): boolean {
	if (expected && typeof expected === "object" && !Array.isArray(expected)) {
		if (!actual || typeof actual !== "object") return false;
		return Object.entries(expected).every(([k, v]) =>
			matches((actual as Record<string, unknown>)[k], v),
		);
	}
	return isDeepStrictEqual(actual, expected);
}

/** Every route with this method and path. */
export async function findRoutes(ctx: Ctx, method: string, path: string) {
	const { items } = await ctx.tool("list_routes", { projectId: ctx.projectId });
	return items.filter((r: any) => r.method === method && r.path === path);
}

export async function findRoute(ctx: Ctx, method: string, path: string) {
	const [route] = await findRoutes(ctx, method, path);
	if (!route) throw new Error(`No route ${method} ${path}`);
	return route;
}

type Request = {
	params?: Record<string, string>;
	query?: Record<string, string>;
	headers?: Record<string, string>;
	body?: unknown;
};

export async function callRoute(ctx: Ctx, method: string, path: string, req: Request = {}) {
	const route = await findRoute(ctx, method, path);
	return (await ctx.tool("call_route", { routeId: route.id, ...req })) as {
		status: number;
		body: unknown;
	};
}

export const routeActive = (method: string, path: string): Check => ({
	name: `${method} ${path} active`,
	run: async (ctx) => {
		const route = await findRoute(ctx, method, path);
		return route.active ? ok("active") : fail("route exists but is inactive");
	},
});

export const oneRoute = (method: string, path: string): Check => ({
	name: `one ${method} ${path}`,
	run: async (ctx) => {
		const n = (await findRoutes(ctx, method, path)).length;
		return n === 1 ? ok("exactly one") : fail(`${n} routes`);
	},
});

/**
 * Calls the route and compares: `status` exactly, `body` as a subset (see
 * `matches`) or a predicate. Retried for a few seconds, since a save can take
 * a moment to reach the workers.
 */
export const expectCall = (
	name: string,
	method: string,
	path: string,
	req: Request,
	want: { status?: number; body?: unknown | ((body: any) => boolean) },
	tries = 5,
): Check => ({
	name,
	run: async (ctx) => {
		let last = "";
		for (let i = 0; i < tries; i++) {
			if (i) await Bun.sleep(1000);
			const res = await callRoute(ctx, method, path, req);
			const statusOk = want.status === undefined || res.status === want.status;
			const bodyOk =
				want.body === undefined ||
				(typeof want.body === "function" ? want.body(res.body) : matches(res.body, want.body));
			last = `${res.status} ${short(res.body)}`;
			if (statusOk && bodyOk) return ok(last);
		}
		return fail(`got ${last}`);
	},
});

/** The agent called one of these tools at least once. */
export const calledTool = (...names: string[]): Check => ({
	name: `called ${names.join(" or ")}`,
	run: async (ctx) =>
		ctx.calls.some((c) => names.includes(c.name))
			? ok("yes")
			: fail(`never called ${names.join(" or ")}`),
});

/** An active trigger starts the workflow named `workflow`, with a schedule `schedule` accepts. */
export const scheduleTrigger = (
	workflow: string,
	schedule: (s: string) => boolean,
	what: string,
): Check => ({
	name: `schedule ${what} starts ${workflow}`,
	run: async (ctx) => {
		const { items } = await ctx.tool("list_triggers", { projectId: ctx.projectId });
		const seen: string[] = [];
		for (const t of items) {
			if (t.type !== "schedule") continue;
			const full = await ctx.tool("get_trigger", { triggerId: t.id });
			seen.push(`${full.schedule} (${t.active ? "active" : "inactive"}, ${t.workflow?.name})`);
			if (t.active && t.workflow?.name === workflow && schedule(String(full.schedule).trim()))
				return ok(full.schedule);
		}
		return fail(seen.length ? `schedule triggers: ${seen.join("; ")}` : "no schedule trigger");
	},
});

/** Runs every test suite of the route now: passes when there is one and all pass. */
export const suitesPass = (method: string, path: string): Check => ({
	name: `test suites of ${method} ${path} pass`,
	run: async (ctx) => {
		const route = await findRoute(ctx, method, path);
		const suites = await ctx.tool("list_test_suites", { targetType: "route", targetId: route.id });
		if (!suites.length) return fail("no test suite");
		for (const s of suites) {
			const run = await ctx.tool("run_test_suite", { testSuiteId: s.id });
			if (run.status !== "passed") return fail(`${s.name}: ${run.status} ${short(run.suites)}`);
		}
		return ok(`${suites.length} suite(s) passed`);
	},
});

/** The canvas of a route has a block of this type. */
export const routeUsesBlock = (method: string, path: string, type: string): Check => ({
	name: `${method} ${path} uses ${type}`,
	run: async (ctx) => {
		const route = await findRoute(ctx, method, path);
		const canvas = await ctx.tool("get_canvas", { target: { kind: "route", id: route.id } });
		return canvas.blocks.some((b: any) => b.type === type) ? ok("yes") : fail("not on the canvas");
	},
});

// ---- setup helpers ----

/** A route whose canvas is entrypoint → jsrunner(code) → response 200. Returns its id. */
export async function routeWithCode(
	ctx: Ctx,
	route: Record<string, unknown> & { method: string; path: string },
	code: string,
) {
	const { id } = await ctx.tool("save_route", {
		projectId: ctx.projectId,
		name: `${route.method} ${route.path}`,
		...route,
	});
	await setCode(ctx, "route", id, code);
	return id as string;
}

/** What a block points at in a get_canvas result: edges read "from[.handle] → to", blocks go by key. */
export const nextKey = (canvas: { edges: string[] }, from: string): string | undefined =>
	canvas.edges.find((e) => e.split(" → ")[0].split(".")[0] === from)?.split(" → ")[1];

/** Puts `code` in a jsrunner right after the entrypoint, before what it pointed at (or the response block). */
export async function setCode(
	ctx: Ctx,
	kind: "route" | "workflow" | "custom_block",
	id: string,
	code: string,
) {
	const target = { kind, id };
	const canvas = await ctx.tool("get_canvas", { target });
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint");
	const linked = nextKey(canvas, entry.key);
	// a new route's response block starts unconnected
	const next = linked ?? canvas.blocks.find((b: any) => b.type === "response")?.key;
	const ops: unknown[] = [
		{ op: "add_block", ref: "code", type: "jsrunner", data: { value: code } },
		...(linked ? [{ op: "disconnect", from: entry.key, to: linked }] : []),
		{ op: "connect", from: entry.key, to: "code" },
		...(next ? [{ op: "connect", from: "code", to: next }] : []),
	];
	await ctx.tool("edit_canvas", { target, version: canvas.version, ops });
}

/** A flow custom block named `name` with text inputs, running `code`. Returns its id. */
export async function customBlock(ctx: Ctx, name: string, inputs: string[], code: string) {
	const { id } = await ctx.tool("save_custom_block", {
		projectId: ctx.projectId,
		name,
		label: name,
		inputParams: inputs.map((n) => ({ type: "text_input", name: n, label: n })),
	});
	await setCode(ctx, "custom_block", id, code);
	return id as string;
}

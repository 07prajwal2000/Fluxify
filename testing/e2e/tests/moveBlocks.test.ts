import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { api, type EnvStack, mcpTool, startEnvStack, stopEnvStack } from "../src/envs";

// Moving blocks between canvases (#752), the real thing: an admin, a production
// and a development worker. copy_blocks reads one canvas and saves into another
// through the normal canvas save; the copy runs on the development worker.

let stack: EnvStack;
const PROJECT = () => stack.projectId;
const SANDBOXES = () => `/v1/projects/${PROJECT()}/sandboxes`;

beforeAll(async () => {
	stack = await startEnvStack();
	// the first read makes the development token and publishes its hash to the worker
	await ok(api(stack, "creator", `/v1/projects/${PROJECT()}/settings/dev-token`));
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

/** a tool call as `as`; a refusal is `ok: false` with its message as `text` */
async function tool(name: string, args: object, as: "creator" | "other" = "creator") {
	const res = await mcpTool(stack, stack.tokens[as], name, args);
	return { ok: res.ok, text: res.text, body: res.ok ? JSON.parse(res.text) : undefined };
}

type Block = { id: string; type: string; data: object };
const js = (value: string): Block => ({ id: Bun.randomUUIDv7(), type: "jsrunner", data: { value } });
const reply = (): Block => ({ id: Bun.randomUUIDv7(), type: "response", data: { httpCode: "200" } });

/**
 * Makes `blocks` the whole chain of a canvas: entrypoint → blocks. The seeded
 * response block and its edges go, so what runs is only what was given.
 */
async function setChain(canvasPath: string, blocks: Block[], as: "creator" | "other" = "creator") {
	const canvas = await ok(api(stack, as, `${canvasPath}/canvas-items`));
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const seeded = canvas.blocks.filter((b: any) => b.type === "response").map((b: any) => b.id);
	const ids = [entry, ...blocks.map((b) => b.id)];
	const edges = ids.slice(1).map((to, i) => ({
		id: Bun.randomUUIDv7(),
		from: ids[i]!,
		to,
		fromHandle: "source",
		toHandle: "source",
	}));
	await ok(
		api(stack, as, `${canvasPath}/save-canvas`, {
			method: "PUT",
			body: {
				actionsToPerform: {
					blocks: [
						...seeded.map((id: string) => ({ id, action: "delete" })),
						...blocks.map((b) => ({ id: b.id, action: "upsert" })),
					],
					edges: [
						...canvas.edges.map((e: any) => ({ id: e.id, action: "delete" })),
						...edges.map((e) => ({ id: e.id, action: "upsert" })),
					],
				},
				changes: {
					blocks: blocks.map((b, i) => ({ ...b, position: { x: 240 * (i + 1), y: 0 } })),
					edges,
				},
			},
		}),
	);
}

async function newRoute(path: string, blocks: Block[], projectId = PROJECT()) {
	const { id } = await ok(
		api(stack, "creator", "/v1/routes", {
			body: { name: `mv${path.replaceAll("/", "-")}`, path, method: "GET", projectId, active: true },
		}),
	);
	await setChain(`/v1/routes/${id}`, blocks);
	return id as string;
}

async function newSandbox(name: string, blocks: Block[], as: "creator" | "other" = "creator") {
	const { id } = await ok(api(stack, as, SANDBOXES(), { body: { name } }));
	await setChain(`${SANDBOXES()}/${id}`, blocks, as);
	return id as string;
}

/** a development worker answer for a route's path, once it serves what `ready` wants */
const onDev = (path: string, ready: (body: any) => boolean) =>
	until(`the development worker to answer ${path}`, async () => {
		const res = await fetch(`${stack.workers.development}${path}`);
		const body = await res.json().catch(() => null);
		return res.status === 200 && ready(body) && body;
	});

/** the sandbox's answer through call_sandbox, once it compiled */
const sandboxAnswer = (sandboxId: string, ready: (body: any) => boolean) =>
	until(`sandbox ${sandboxId} to answer`, async () => {
		const res = await tool("call_sandbox", { projectId: PROJECT(), sandboxId });
		if (!res.ok || res.body.status !== 200) return false;
		const body = typeof res.body.body === "string" ? JSON.parse(res.body.body) : res.body.body;
		return ready(body) && body;
	});

const canvasOf = async (target: object) =>
	(await tool("get_canvas", { target: { ...target, projectId: PROJECT() } })).body;

describe("a route copied into a new sandbox", () => {
	it("makes a sandbox named after it that answers the way the route does", async () => {
		const routeId = await newRoute("/mv-answer", [js("return { answer: 42 };"), reply()]);
		const viaRoute = await onDev("/mv-answer", (b) => b?.answer === 42);
		const routeBefore = await canvasOf({ kind: "route", id: routeId });

		const res = await tool("copy_blocks", {
			projectId: PROJECT(),
			from: { kind: "route", id: routeId },
			to: "__new_sandbox__",
		});
		expect(res.ok).toBe(true);
		expect(res.body.target).toMatchObject({ kind: "sandbox", name: "mv-mv-answer sandbox" });
		// each source key maps to the key its copy got on the sandbox
		const copied = res.body.keys as Record<string, string>;
		expect(Object.keys(copied).map((k) => k.replace(/_\d+$/, "")).sort()).toEqual([
			"jsrunner",
			"response",
		]);
		for (const [from, to] of Object.entries(copied))
			expect(to.replace(/_\d+$/, "")).toBe(from.replace(/_\d+$/, ""));

		const sandboxes = await ok(api(stack, "creator", SANDBOXES()));
		expect(sandboxes.data.map((s: any) => s.name)).toContain("mv-mv-answer sandbox");

		const viaSandbox = await sandboxAnswer(res.body.target.id, (b) => b?.answer === 42);
		expect(viaSandbox).toEqual(viaRoute);

		// the route itself is untouched
		const after = await canvasOf({ kind: "route", id: routeId });
		expect(after).toEqual(routeBefore);
	}, 180_000);
});

describe("blocks copied from a sandbox back into a route", () => {
	it("attaches three connected blocks to a route block, and the route runs them", async () => {
		const routeId = await newRoute("/mv-back", [js("return { base: 1 };")]);
		await onDev("/mv-back", () => true).catch(() => null);

		const sandboxId = await newSandbox("fix", [
			js("return { n: input.base + 1 };"),
			js("return { n: input.n * 10 };"),
			reply(),
		]);
		const sandbox = await canvasOf({ kind: "sandbox", id: sandboxId });
		const keys = sandbox.blocks
			.map((b: any) => b.key as string)
			.filter((k: string) => !/^(entrypoint|error_handler)_/.test(k));
		expect(keys).toHaveLength(3);

		const res = await tool("copy_blocks", {
			projectId: PROJECT(),
			from: { kind: "sandbox", id: sandboxId },
			keys,
			to: { kind: "route", id: routeId },
			connect_from: { from: "jsrunner_1" },
		});
		expect(res.ok).toBe(true);
		expect(res.body.target).toEqual({ kind: "route", id: routeId });

		const answer = await onDev("/mv-back", (b) => b?.n === 20);
		expect(answer).toEqual({ n: 20 });
	}, 180_000);

	it("saves all or nothing: a copy the canvas save refuses leaves the route as it was", async () => {
		const routeId = await newRoute("/mv-atomic", [js("return { ok: true };"), reply()]);
		const before = await canvasOf({ kind: "route", id: routeId });
		const sandboxId = await newSandbox("loose", [js("return 1;")]);

		// the route's own jsrunner_1 already goes somewhere: connecting to it is refused
		const res = await tool("copy_blocks", {
			projectId: PROJECT(),
			from: { kind: "sandbox", id: sandboxId },
			to: { kind: "route", id: routeId },
			connect_from: { from: "jsrunner_1" },
		});
		expect(res.ok).toBe(false);
		expect(res.text).toContain("Disconnect it first");

		const after = await canvasOf({ kind: "route", id: routeId });
		expect(after.blocks).toHaveLength(before.blocks.length);
		expect(after.version).toBe(before.version);
	}, 120_000);
});

describe("what copy_blocks refuses", () => {
	it("another creator's sandbox is a not found, and no sandbox is made", async () => {
		const theirs = await newSandbox("theirs", [js("return 1;")], "other");
		const before = await ok(api(stack, "creator", SANDBOXES()));

		const res = await tool("copy_blocks", {
			projectId: PROJECT(),
			from: { kind: "sandbox", id: theirs },
			to: "__new_sandbox__",
		});
		expect(res.ok).toBe(false);
		expect(res.text).toContain("Not found");

		const after = await ok(api(stack, "creator", SANDBOXES()));
		expect(after.data).toHaveLength(before.data.length);
	}, 60_000);

	it("a canvas of another project, as source or as target", async () => {
		const elsewhere = await newRoute("/mv-elsewhere", [js("return 1;")], stack.otherProjectId);
		const mine = await newSandbox("mine", [js("return 2;")]);

		const asSource = await tool("copy_blocks", {
			projectId: PROJECT(),
			from: { kind: "route", id: elsewhere },
			to: "__new_sandbox__",
		});
		expect(asSource.ok).toBe(false);
		expect(asSource.text).toContain("another project");

		const asTarget = await tool("copy_blocks", {
			projectId: PROJECT(),
			from: { kind: "sandbox", id: mine },
			to: { kind: "route", id: elsewhere },
		});
		expect(asTarget.ok).toBe(false);
		expect(asTarget.text).toContain("another project");

		const route = await canvasOf({ kind: "route", id: elsewhere });
		expect(route.blocks.filter((b: any) => b.type === "jsrunner")).toHaveLength(1);
	}, 60_000);
});

describe("run_blocks with from", () => {
	it("runs a saved route's blocks and returns its output, saving nothing", async () => {
		const routeId = await newRoute("/mv-run", [js("return { answer: 7 };"), reply()]);
		const sandboxesBefore = await ok(api(stack, "creator", SANDBOXES()));

		const res = await tool("run_blocks", {
			projectId: PROJECT(),
			from: { kind: "route", id: routeId },
		});
		expect(res.ok).toBe(true);
		expect(res.body).toMatchObject({ status: 200, body: { answer: 7 } });
		expect(res.body.trace.join("\n")).toContain("jsrunner_1 (jsrunner) ok");

		const sandboxesAfter = await ok(api(stack, "creator", SANDBOXES()));
		expect(sandboxesAfter.data).toHaveLength(sandboxesBefore.data.length);
	}, 120_000);
});

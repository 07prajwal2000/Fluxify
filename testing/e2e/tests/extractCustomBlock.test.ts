import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { api, type EnvStack, startEnvStack, stopEnvStack } from "../src/envs";

// Extract a canvas selection to a custom block (#753), the real thing: the
// block is created with its canvas in one request, optionally replaces the
// selection, and the route answers the same as before on the development worker.

let stack: EnvStack;
const PROJECT = () => stack.projectId;

beforeAll(async () => {
	stack = await startEnvStack();
	// the first read makes the development token and publishes its hash to the worker
	await ok(api(stack, "creator", `/v1/projects/${PROJECT()}/settings/dev-token`));
}, 600_000);

afterAll(stopEnvStack);

async function ok(call: Promise<{ status: number; body: any }>) {
	const { status, body } = await call;
	if (status >= 300) throw new Error(`${status} ${JSON.stringify(body)}`);
	return body;
}

async function onDev(path: string, ready: (body: any) => boolean, ms = 60_000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		const res = await fetch(`${stack.workers.development}${path}`).catch(() => null);
		const body = await res?.json().catch(() => null);
		if (res?.status === 200 && ready(body)) return body;
		await Bun.sleep(300);
	}
	throw new Error(`timed out waiting for the development worker to answer ${path}`);
}

type Block = { id: string; type: string; data: object };
const js = (value: string): Block => ({ id: Bun.randomUUIDv7(), type: "jsrunner", data: { value } });
const reply = (): Block => ({ id: Bun.randomUUIDv7(), type: "response", data: { httpCode: "200" } });

/** entrypoint → blocks, in order; the seeded response block goes */
async function setChain(routeId: string, blocks: Block[]) {
	const base = `/v1/routes/${routeId}`;
	const canvas = await ok(api(stack, "creator", `${base}/canvas-items`));
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const seeded = canvas.blocks.filter((b: any) => b.type === "response").map((b: any) => b.id);
	const ids = [entry, ...blocks.map((b) => b.id)];
	const edges = ids.slice(1).map((to, i) => ({
		id: Bun.randomUUIDv7(),
		from: ids[i]!,
		to,
		fromHandle: `${ids[i]}-source`,
		toHandle: `${to}-target`,
	}));
	await ok(
		api(stack, "creator", `${base}/save-canvas`, {
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

async function newRoute(path: string, blocks: Block[]) {
	const { id } = await ok(
		api(stack, "creator", "/v1/routes", {
			body: {
				name: `ex${path.replaceAll("/", "-")}`,
				path,
				method: "GET",
				projectId: PROJECT(),
				active: true,
			},
		}),
	);
	await setChain(id, blocks);
	return id as string;
}

const keysOf = async (routeId: string, type: string) =>
	(await ok(api(stack, "creator", `/v1/routes/${routeId}/canvas-items`))).blocks
		.filter((b: any) => b.type === type)
		.map((b: any) => b.key as string);

const extract = (routeId: string, body: object) =>
	api(stack, "creator", "/v1/custom-blocks/extract", {
		body: { projectId: PROJECT(), source: { kind: "route", id: routeId }, ...body },
	});

describe("extracting a selection to a custom block", () => {
	it("keeps the output the same, with and without replacing the selection", async () => {
		const routeId = await newRoute("/ex-same", [
			js("return { a: 20 };"),
			js("return { answer: input.a + 22 };"),
			reply(),
		]);
		const before = await onDev("/ex-same", (b) => b?.answer === 42);
		const keys = await keysOf(routeId, "jsrunner");
		expect(keys).toHaveLength(2);

		// only a name and a label: the block runs straight away, and the route is untouched
		const plain = await ok(extract(routeId, { keys, name: "ex_plain", label: "Ex plain" }));
		expect(plain.instanceKey).toBeUndefined();
		expect(await keysOf(routeId, "jsrunner")).toEqual(keys);

		// replace: two blocks become one instance of the new block, same answer
		const replaced = await ok(
			extract(routeId, { keys, name: "ex_replaced", label: "Ex replaced", replace: true }),
		);
		expect(replaced.instanceKey).toMatch(/^custom_ex_replaced_\d+$/);
		expect(await keysOf(routeId, "jsrunner")).toHaveLength(0);
		expect(await onDev("/ex-same", (b) => b?.answer === 42)).toEqual(before);
	}, 240_000);

	it("refuses an empty selection, a missing name, an unknown key and a duplicate name", async () => {
		const routeId = await newRoute("/ex-bad", [js("return 1;"), reply()]);
		const [key] = await keysOf(routeId, "jsrunner");
		expect((await extract(routeId, { keys: [], name: "ex_bad", label: "Bad" })).status).toBe(400);
		expect((await extract(routeId, { keys: [key], name: "", label: "Bad" })).status).toBe(400);
		expect((await extract(routeId, { keys: ["nope_1"], name: "ex_bad", label: "Bad" })).status).toBe(
			400,
		);
		await ok(extract(routeId, { keys: [key], name: "ex_dupe", label: "Dupe" }));
		expect((await extract(routeId, { keys: [key], name: "ex_dupe", label: "Dupe" })).status).toBe(
			409,
		);
	}, 120_000);

	it("asks to tidy a selection with two entry blocks, and extracts nothing", async () => {
		const routeId = await newRoute("/ex-tidy", [js("return 1;"), js("return 2;"), js("return 3;"), reply()]);
		const [first, , third] = await keysOf(routeId, "jsrunner");
		const res = await extract(routeId, { keys: [first, third], name: "ex_tidy", label: "Tidy" });
		expect(res.status).toBe(400);
		expect(JSON.stringify(res.body)).toContain("Tidy the selection");
		const blocks = await ok(api(stack, "creator", `/v1/custom-blocks/list?projectId=${PROJECT()}`));
		expect(JSON.stringify(blocks)).not.toContain("ex_tidy");
	}, 120_000);
});

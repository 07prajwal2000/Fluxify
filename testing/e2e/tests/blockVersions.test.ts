import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { api, type EnvStack, startEnvStack, stopEnvStack } from "../src/envs";

// Custom block versions (#740), the real thing: an admin, a production and a
// development worker. A custom block works like a shared library: development
// runs its latest saved state, production its promoted version, and promoting or
// rolling one back changes what every production route that uses it answers,
// without touching the route.

let stack: EnvStack;
let token: string;
const PROJECT = () => stack.projectId;
const TOKEN_HEADER = "x-fluxify-dev-token";

beforeAll(async () => {
	stack = await startEnvStack();
	// the first read makes the development token and publishes its hash to development
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

type Kind = "routes" | "custom-blocks";
type Block = { id: string; type: string; data: object };

/** `blocks` as one chain hanging off the canvas's entrypoint; calling again edits those blocks in place */
async function chain(path: string, blocks: Block[]) {
	const canvas = await ok(api(stack, "creator", `${path}/canvas-items`));
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const ids = [entry, ...blocks.map((b) => b.id)];
	const edges = ids.slice(1).map((to, i) => ({
		id: Bun.randomUUIDv7(),
		from: ids[i]!,
		to,
		fromHandle: "source",
		toHandle: "source",
	}));
	const fresh = edges.filter(
		(e) => !canvas.edges.some((old: any) => old.from === e.from && old.to === e.to),
	);
	await ok(
		api(stack, "creator", `${path}/save-canvas`, {
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

const say = (value: string) => `return { say: ${JSON.stringify(value)} };`;

/** a custom block that answers `{ say }`; its own canvas is entrypoint -> one JS block */
async function newBlock(name: string, says: string) {
	const { id } = await ok(
		api(stack, "creator", "/v1/custom-blocks", {
			body: { name, label: name, projectId: PROJECT() },
		}),
	);
	const js = Bun.randomUUIDv7();
	await chain(`/v1/custom-blocks/${id}`, [{ id: js, type: "jsrunner", data: { value: say(says) } }]);
	const full = await ok(api(stack, "creator", `/v1/custom-blocks/${id}`));
	return { id: id as string, js, name: full.name as string };
}

const setBlockSays = (block: { id: string; js: string }, says: string) =>
	chain(`/v1/custom-blocks/${block.id}`, [
		{ id: block.js, type: "jsrunner", data: { value: say(says) } },
	]);

/** a route that answers what the custom block answers: entrypoint -> block -> response */
async function newRoute(path: string, blockName: string) {
	const { id } = await ok(
		api(stack, "creator", "/v1/routes", {
			body: { name: `bv${path.replaceAll("/", "-")}`, path, method: "GET", projectId: PROJECT(), active: true },
		}),
	);
	const canvas = await ok(api(stack, "creator", `/v1/routes/${id}/canvas-items`));
	const reply = canvas.blocks.find((b: any) => b.type === "response")?.id ?? Bun.randomUUIDv7();
	await chain(`/v1/routes/${id}`, [
		{ id: Bun.randomUUIDv7(), type: blockName, data: { invoke: "sync" } },
		{ id: reply, type: "response", data: { httpCode: "200" } },
	]);
	return id as string;
}

const commit = async (kind: Kind, id: string, title: string) =>
	(await ok(api(stack, "creator", `/v1/${kind}/${id}/versions`, { body: { title } }))).id as string;

const deploy = (kind: Kind, id: string, versionId: string, description = "go live") =>
	api(stack, "creator", `/v1/${kind}/${id}/deployments`, { body: { versionId, description } });

/** commit what is saved now and put it live */
async function release(kind: Kind, id: string, title = "release") {
	const body = await ok(deploy(kind, id, await commit(kind, id, title)));
	expect(body.status).toBe("live");
	return body;
}

async function hit(worker: "production" | "development", path: string) {
	const res = await fetch(`${stack.workers[worker]}${path}`, {
		headers: worker === "development" ? { [TOKEN_HEADER]: token } : {},
	});
	const text = await res.text();
	let body: any = text;
	try {
		body = JSON.parse(text);
	} catch {}
	return { status: res.status, body };
}

/** the worker's answer, once it says what `want` expects */
const says = (worker: "production" | "development", path: string, want: string) =>
	until(`${worker} to answer ${want} on ${path}`, async () => {
		const res = await hit(worker, worker === "development" ? `/_/dev${path}` : path);
		return res.status === 200 && res.body?.say === want && res;
	});

describe("a custom block promoted and rolled back under a live route", () => {
	it("production answers the promoted version while development answers the working copy", async () => {
		const block = await newBlock("shared_greeting", "one");
		await release("custom-blocks", block.id, "Says one");
		const route = await newRoute("/greeting", block.name);
		await release("routes", route, "Calls the greeting");
		await says("production", "/greeting", "one");
		await says("development", "/greeting", "one");

		// v2 is committed, and the working copy moves on to v3 before anything is promoted
		await setBlockSays(block, "two");
		const v2 = await commit("custom-blocks", block.id, "Says two");
		await setBlockSays(block, "three");
		await says("development", "/greeting", "three");
		await Bun.sleep(1_500);
		expect((await hit("production", "/greeting")).body.say).toBe("one");

		// promoting the block changes the route without a promote of the route
		const promoted = await ok(deploy("custom-blocks", block.id, v2, "Greeting v2"));
		expect(promoted).toMatchObject({ status: "live", action: "promote", kind: "custom_block" });
		await says("production", "/greeting", "two");
		expect((await hit("development", "/_/dev/greeting")).body.say).toBe("three");
		expect(await ok(api(stack, "creator", `/v1/custom-blocks/${block.id}`))).toMatchObject({
			prodVersionNumber: 2,
			uncommitted: true,
		});

		// rolling it back puts v1 back under the same route
		const versions = (await ok(api(stack, "creator", `/v1/custom-blocks/${block.id}/versions`))).versions;
		const v1 = versions.find((v: any) => v.versionNumber === 1).id;
		const back = await ok(deploy("custom-blocks", block.id, v1, "v2 was wrong"));
		expect(back).toMatchObject({ status: "live", action: "rollback", versionNumber: 1 });
		await says("production", "/greeting", "one");
		expect((await hit("development", "/_/dev/greeting")).body.say).toBe("three");

		// and the block cannot be deleted from under the route that runs it
		const refused = await api(stack, "creator", `/v1/custom-blocks/${block.id}`, { method: "DELETE" });
		expect(refused.status).toBe(409);
		expect(refused.body.references).toEqual([
			expect.objectContaining({ kind: "route", id: route, inProduction: true, inWorkingCopy: true }),
		]);
		const used = await ok(api(stack, "creator", `/v1/custom-blocks/${block.id}/references`));
		expect(used.references.map((r: any) => r.id)).toEqual([route]);
	}, 300_000);

	it("a route cannot go live while its block is not, and goes live once it is", async () => {
		const block = await newBlock("late_block", "late");
		const route = await newRoute("/late", block.name);
		const v1 = await commit("routes", route, "Calls the block");

		const refused = await ok(deploy("routes", route, v1));
		expect(refused.status).toBe("failed");
		const gate = refused.gates.find((g: any) => g.gate === "custom_blocks");
		expect(gate).toMatchObject({
			status: "failed",
			refs: [{ kind: "custom_block", id: block.id, name: block.name }],
		});
		expect((await hit("production", "/late")).status).toBe(404);

		// the block goes live first; the route goes live after, by its own promote
		await release("custom-blocks", block.id, "Live");
		const live = await ok(deploy("routes", route, v1));
		expect(live.status).toBe("live");
		await says("production", "/late", "late");
	}, 300_000);
});

describe("a sandbox that uses a block that was deleted", () => {
	it("fails its run clearly, logs it, and takes nothing else down", async () => {
		const block = await newBlock("doomed_block", "alive");
		const healthy = await newRoute("/healthy", (await newBlock("steady_block", "steady")).name);
		await says("development", "/healthy", "steady");
		expect(healthy).toBeTruthy();

		const { id: sandbox } = await ok(
			api(stack, "creator", `/v1/projects/${PROJECT()}/sandboxes`, { body: { name: "uses-doomed" } }),
		);
		await chain(`/v1/projects/${PROJECT()}/sandboxes/${sandbox}`, [
			{ id: Bun.randomUUIDv7(), type: block.name, data: { invoke: "sync" } },
			{ id: Bun.randomUUIDv7(), type: "response", data: { httpCode: "200" } },
		]);
		const path = `/_sandbox/${sandbox}/run`;
		await until("the sandbox to answer", async () => {
			const res = await hit("development", path);
			return res.status === 200 && res.body?.say === "alive" && res;
		});

		// sandboxes are not users: the delete goes through
		const deleted = await api(stack, "creator", `/v1/custom-blocks/${block.id}`, { method: "DELETE" });
		expect(deleted.status).toBe(200);

		// the sandbox's next run is a normal failed run that names the block
		const failed = await until("the sandbox to fail", async () => {
			const res = await hit("development", path);
			return res.status >= 400 && res;
		});
		expect(JSON.stringify(failed.body)).toContain(`Custom block not loaded: ${block.name}`);

		// the failed run leaves a runtime log for the sandbox
		const log = await until("a runtime log", async () => {
			const rows = await ok(
				api(
					stack,
					"creator",
					`/v1/projects/${PROJECT()}/system-logs?type=runtime&resourceType=sandbox&resourceId=${sandbox}&limit=20`,
				),
			);
			const list = Array.isArray(rows) ? rows : (rows.logs ?? rows.items ?? []);
			return list.find((row: any) => String(row.message).includes("Custom block not loaded")) ?? false;
		});
		expect(log.message).toContain(block.name);

		// the worker and its other routes are fine, and so is the sandbox's own compile
		expect((await says("development", "/healthy", "steady")).status).toBe(200);
		const again = await hit("development", path);
		expect(again.status).toBeGreaterThanOrEqual(400);
	}, 300_000);
});

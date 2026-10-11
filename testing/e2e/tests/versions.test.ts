import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { api, type EnvStack, mcpTool, startEnvStack, stopEnvStack } from "../src/envs";

// Versions (#738), the real thing: an admin, a production and a development
// worker. Committing keeps a named copy and changes nothing that runs; checking
// a version out puts its canvas back into the working copy, and the development
// worker recompiles it and answers as it did then.

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

const BLOCK = Bun.randomUUIDv7();

/** One JS block between the entrypoint and the seeded response; calling again changes its script. */
async function setScript(routeId: string, value: string) {
	const path = `/v1/routes/${routeId}`;
	const canvas = await ok(api(stack, "creator", `${path}/canvas-items`));
	const first = !canvas.blocks.some((b: any) => b.id === BLOCK);
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const response = canvas.blocks.find((b: any) => b.type === "response").id;
	const edges = first
		? [
				{ id: Bun.randomUUIDv7(), from: entry, to: BLOCK, fromHandle: "source", toHandle: "source" },
				{ id: Bun.randomUUIDv7(), from: BLOCK, to: response, fromHandle: "source", toHandle: "source" },
			]
		: [];
	const blocks = [{ id: BLOCK, type: "jsrunner", position: { x: 240, y: 0 }, data: { value } }];
	await ok(
		api(stack, "creator", `${path}/save-canvas`, {
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
}

/** the development worker's answer, once it says what `want` expects */
const answers = (path: string, want: string) =>
	until(`development to answer ${want} on ${path}`, async () => {
		const res = await fetch(`${stack.workers.development}/_/dev${path}`, {
			headers: { [TOKEN_HEADER]: token },
		});
		if (res.status !== 200) return false;
		const body = (await res.json()) as { say?: string };
		return body.say === want && body;
	});

describe("commit and check out on a live route", () => {
	it("brings the old behaviour back, and nothing that was edited since is lost", async () => {
		const { id } = await ok(
			api(stack, "creator", "/v1/routes", {
				body: { name: "versioned", path: "/versioned", method: "GET", projectId: PROJECT() },
			}),
		);
		const route = () => ok(api(stack, "creator", `/v1/routes/${id}`));
		const versions = () => ok(api(stack, "creator", `/v1/routes/${id}/versions`));

		await setScript(id, "return { say: 'one' };");
		await answers("/versioned", "one");

		// v1 keeps what runs now
		const v1 = await ok(
			api(stack, "creator", `/v1/routes/${id}/versions`, {
				body: { title: "Says one", description: "the first behaviour" },
			}),
		);
		expect(v1).toMatchObject({ versionNumber: 1, title: "Says one", isHead: true });
		expect(await route()).toMatchObject({ headVersionNumber: 1, uncommitted: false });
		// nothing changed since: a second commit is refused
		const again = await api(stack, "creator", `/v1/routes/${id}/versions`, { body: { title: "Twice" } });
		expect(again.status).toBe(409);

		// the working copy moves on, and development runs it as soon as it is saved
		await setScript(id, "return { say: 'two' };");
		await answers("/versioned", "two");
		expect(await route()).toMatchObject({ headVersionNumber: 1, uncommitted: true });

		// checking v1 out saves the work in progress first, then runs v1 again
		const out = await ok(
			api(stack, "creator", `/v1/routes/${id}/versions/${v1.id}/checkout`, { body: {} }),
		);
		expect(out.savedVersion).toMatchObject({
			versionNumber: 2,
			title: "Saved before checking out v1",
			parentId: v1.id,
		});
		expect(out.checkedOut).toMatchObject({ versionNumber: 1, isHead: true });
		await answers("/versioned", "one");
		expect(await route()).toMatchObject({ headVersionNumber: 1, uncommitted: false });

		// the work that was in progress is still there, as v2
		const v2 = out.savedVersion.id;
		await ok(api(stack, "creator", `/v1/routes/${id}/versions/${v2}/checkout`, { body: {} }));
		await answers("/versioned", "two");

		const history = await versions();
		expect(history.uncommitted).toBe(false);
		expect(history.versions.map((v: any) => v.versionNumber)).toEqual([2, 1]);
		expect(history.versions.find((v: any) => v.isHead).versionNumber).toBe(2);
	}, 180_000);

	it("is the same through the agent's tools", async () => {
		const { id } = await ok(
			api(stack, "creator", "/v1/routes", {
				body: { name: "versioned-mcp", path: "/versioned-mcp", method: "GET", projectId: PROJECT() },
			}),
		);
		await setScript(id, "return { say: 'one' };");
		const tool = async (name: string, args: object) => {
			const res = await mcpTool(stack, stack.tokens.creator, name, { kind: "route", id, ...args });
			return { ok: res.ok, text: res.text, body: res.ok ? JSON.parse(res.text) : undefined };
		};

		const committed = await tool("commit_version", { title: "First" });
		expect(committed.body).toMatchObject({ versionNumber: 1, title: "First" });
		const listed = await tool("list_versions", {});
		expect(listed.body.uncommitted).toBe(false);
		expect(listed.body.versions).toHaveLength(1);

		await setScript(id, "return { say: 'two' };");
		await answers("/versioned-mcp", "two");
		const out = await tool("checkout_version", { versionId: committed.body.versionId });
		expect(out.body).toMatchObject({
			checkedOut: { versionNumber: 1 },
			savedVersion: { versionNumber: 2, title: "Saved before checking out v1" },
		});
		await answers("/versioned-mcp", "one");

		const seen = await tool("get_version", { versionId: committed.body.versionId, compact: true });
		expect(seen.body.settings).toMatchObject({ path: "/versioned-mcp", method: "GET" });
		expect(seen.body.blocks.some((b: any) => b.type === "jsrunner")).toBe(true);

		const refused = await tool("commit_version", { title: "Nothing new" });
		expect(refused.ok).toBe(false);
		expect(refused.text).toContain("Nothing to commit");
	}, 180_000);
});

describe("who may commit", () => {
	it("lets a viewer read the history and refuses a commit", async () => {
		const { id } = await ok(
			api(stack, "creator", "/v1/routes", {
				body: { name: "versioned-roles", path: "/versioned-roles", method: "GET", projectId: PROJECT() },
			}),
		);
		await setScript(id, "return { say: 'one' };");
		await ok(api(stack, "creator", `/v1/routes/${id}/versions`, { body: { title: "One" } }));

		expect((await api(stack, "viewer", `/v1/routes/${id}/versions`)).status).toBe(200);
		const refused = await api(stack, "viewer", `/v1/routes/${id}/versions`, { body: { title: "No" } });
		expect(refused.status).toBe(403);
	}, 120_000);
});

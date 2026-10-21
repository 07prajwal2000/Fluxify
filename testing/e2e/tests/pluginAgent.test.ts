import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { api, type EnvStack, promote, startEnvStack, stopEnvStack } from "../src/envs";

// A real plugin, end to end: `examples/plugins/agent-tools` built by the CLI,
// uploaded, approved and switched on, installed by a development and a production
// worker, then a route whose Agent block calls two Tool blocks, each with a chain
// of its own. The "model" is a script, so the answer never changes.

const EXAMPLE = join(import.meta.dir, "../../../examples/plugins/agent-tools");
const PLUGIN = "fluxify-examples/agent-tools";
const AGENT = `${PLUGIN}/agent`;
const TOOL = `${PLUGIN}/tool`;
const PROMPT = "search the catalog, then email Ada";

let stack: EnvStack;
const project = () => stack.projectId;

beforeAll(async () => {
	stack = await startEnvStack();
}, 600_000);

afterAll(stopEnvStack);

async function ok(call: Promise<{ status: number; body: any }>) {
	const { status, body } = await call;
	if (status >= 300) throw new Error(`${status} ${JSON.stringify(body)}`);
	return body;
}

async function until<T>(what: string, probe: () => Promise<T | false>, ms = 120_000): Promise<T> {
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

/** the tarball `fluxify-cli blocks build` makes: the file an author uploads */
async function buildExample() {
	const build = Bun.spawn([process.execPath, "run", "build"], {
		cwd: EXAMPLE,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		build.exited,
		new Response(build.stdout).text(),
		new Response(build.stderr).text(),
	]);
	if (code) throw new Error(`the example did not build: ${out}${err}`);
	return Bun.file(join(EXAMPLE, "fluxify-examples-agent-tools-1.0.0.tgz"));
}

/** an upload is multipart, so `api` (JSON only) cannot send it */
async function upload(tgz: Blob) {
	const form = new FormData();
	form.append("file", tgz, "plugin.tgz");
	const res = await fetch(`${stack.url}/_/admin/api/v1/plugins/upload?projectId=${project()}`, {
		method: "POST",
		headers: { authorization: `Bearer ${stack.tokens.creator}` },
		body: form,
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`upload: ${res.status} ${JSON.stringify(body)}`);
	return body as { integrity: string; approval: string };
}

const plugin = (path = "") => `/v1/plugins/${PLUGIN}${path}?projectId=${project()}`;

/** one block on the canvas; `data` holds its params, `order` the branch order of an allowMultiple handle */
const block = (id: string, type: string, data: object, x: number, y: number) => ({
	id,
	type,
	position: { x, y },
	data,
});
/** handle ids are `<blockId>-<name>`, as the portal writes them */
const edge = (from: string, to: string, handle = "source") => ({
	id: Bun.randomUUIDv7(),
	from,
	to,
	fromHandle: `${from}-${handle}`,
	toHandle: `${to}-target`,
});

describe("the agent-tools example plugin", () => {
	it("uploads, installs on both workers, and an Agent route calls its two tools", async () => {
		const tgz = await buildExample();
		const added = await upload(tgz);
		expect(added.approval).toBe("pending");

		// nothing runs before a creator approves, and the plugin is switched on per environment
		await ok(api(stack, "creator", plugin("/approve"), { body: { integrity: added.integrity } }));
		await ok(api(stack, "creator", plugin("/environments"), { method: "PUT", body: { dev: true, prod: true } }));
		await until("both workers to install the plugin", async () => {
			const status = await ok(api(stack, "creator", plugin("/install-status")));
			if (status.failed) throw new Error(JSON.stringify(status.nodes));
			return status.done && status.nodes.length >= 2 && status;
		});

		const route = await ok(
			api(stack, "creator", "/v1/routes", {
				body: { name: "agent-tools", path: "/agent", method: "GET", projectId: project(), active: true },
			}),
		);
		const canvas = await ok(api(stack, "creator", `/v1/routes/${route.id}/canvas-items`));
		const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
		const response = canvas.blocks.find((b: any) => b.type === "response").id;

		const [agent, search, email, searchLogic, emailLogic] = Array.from({ length: 5 }, () => Bun.randomUUIDv7());
		const blocks = [
			block(agent, AGENT, { prompt: PROMPT, order: [search, email] }, 240, 0),
			block(search, TOOL, { name: "search" }, 480, 200),
			block(email, TOOL, { name: "email" }, 480, 320),
			// what each tool does: the arguments are the chain's input
			block(searchLogic, "jsrunner", { value: "return { hits: ['dune', 'neuromancer'], for: input.text };" }, 720, 200),
			block(emailLogic, "jsrunner", { value: "return { sent: true };" }, 720, 320),
		];
		const edges = [
			edge(entry, agent),
			edge(agent, response, "success"),
			edge(agent, search, "tools"),
			edge(agent, email, "tools"),
			edge(search, searchLogic, "execute"),
			edge(email, emailLogic, "execute"),
		];
		await ok(
			api(stack, "creator", `/v1/routes/${route.id}/save-canvas`, {
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

		// a promoted version is what the production worker serves
		await promote(stack, route.id);
		const expected = {
			answer: "used search, email",
			calls: [
				{
					tool: "search",
					args: { text: PROMPT },
					result: { hits: ["dune", "neuromancer"], for: PROMPT },
				},
				{ tool: "email", args: { text: PROMPT }, result: { sent: true } },
			],
		};
		const answer = await until("the public path to answer", async () => {
			const res = await fetch(`${stack.workers.production}/agent`);
			return res.status === 200 && (await res.json());
		});
		expect(answer).toEqual(expected);
	}, 600_000);
});

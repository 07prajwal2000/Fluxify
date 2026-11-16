import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SQL } from "bun";
import { api, type EnvStack, startEnvStack, stopEnvStack } from "../src/envs";

// A new project from a template file (#1104), the real thing: an admin, NATS and a
// real development worker. A project with a route and a scheduled workflow is
// downloaded as a template, then restored into a new project through the upload
// endpoint. The route answers at `/_/dev/<path>` without anyone saving anything,
// so the worker got the artifacts through the NATS store from the restore's own
// compile. Production stays off, as a template's does.

const KEY = "e2e-restore-system-key";
const PATH = "/restored-hello";
let stack: EnvStack;
const PROJECT = () => stack.projectId;

beforeAll(async () => {
	// creating a project takes a system admin; the stack's users are project creators
	stack = await startEnvStack({ env: { SYSTEM_ACCESS_KEY: KEY } });
}, 600_000);

afterAll(stopEnvStack);

async function ok(call: Promise<{ status: number; body: any }>) {
	const { status, body } = await call;
	if (status >= 300) throw new Error(`${status} ${JSON.stringify(body)}`);
	return body;
}

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

/** one jsrunner between a canvas's entrypoint and, for a route, its response */
async function script(canvasPath: string, value: string, toResponse: boolean) {
	const canvas = await ok(api(stack, "creator", `${canvasPath}/canvas-items`));
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const response = canvas.blocks.find((b: any) => b.type === "response")?.id;
	const block = { id: Bun.randomUUIDv7(), type: "jsrunner", data: { value }, position: { x: 240, y: 0 } };
	const ids = [entry, block.id, ...(toResponse ? [response] : [])];
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
					blocks: [{ id: block.id, action: "upsert" }],
					edges: edges.map((e) => ({ id: e.id, action: "upsert" })),
				},
				changes: { blocks: [block], edges },
			},
		}),
	);
}

/** the source project as a template, through the manual backup the portal uses */
async function downloadTemplate() {
	const { sections } = await ok(api(stack, "creator", `/v1/${PROJECT()}/backups/sections`));
	const { id } = await ok(
		api(stack, "creator", `/v1/${PROJECT()}/backups`, {
			body: {
				mode: "template",
				sections: sections.map((s: { name: string }) => s.name),
				includeVersionHistory: false,
				includeAppConfigValues: false,
			},
		}),
	);
	await until("the template to be made", async () => {
		const { backups } = await ok(api(stack, "creator", `/v1/${PROJECT()}/backups`));
		const row = backups.find((b: { id: string }) => b.id === id);
		if (row.status === "failed") throw new Error(row.error);
		return row.status === "succeeded";
	});
	const res = await fetch(`${stack.url}/_/admin/api/v1/${PROJECT()}/backups/${id}/download`, {
		headers: { authorization: `Bearer ${stack.tokens.creator}` },
	});
	expect(res.status).toBe(200);
	return new Uint8Array(await res.arrayBuffer());
}

function upload(path: string, bytes: Uint8Array, fields: Record<string, string> = {}) {
	const form = new FormData();
	form.set("file", new File([bytes], "template.tar.gz"));
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	return fetch(`${stack.url}/_/admin/api/v1/projects${path}`, {
		method: "POST",
		headers: { authorization: `Bearer ${stack.tokens.creator}`, SYSTEM_ACCESS_KEY: KEY },
		body: form,
	});
}

describe("a new project from a template file", () => {
	it("serves the restored route at /_/dev on a real worker, with nobody saving anything", async () => {
		// the source: a live route and a workflow on a schedule
		const route = await ok(
			api(stack, "creator", "/v1/routes", {
				body: { name: "restored-hello", path: PATH, method: "GET", projectId: PROJECT(), active: true },
			}),
		);
		await script(`/v1/routes/${route.id}`, "return { hello: 'restored' };", true);
		const workflow = await ok(
			api(stack, "creator", "/v1/workflows", { body: { name: "nightly", projectId: PROJECT(), active: true } }),
		);
		await script(`/v1/workflows/${workflow.id}`, "return { ran: true };", false);
		await ok(
			api(stack, "creator", "/v1/triggers", {
				body: {
					projectId: PROJECT(),
					name: "every-hour",
					type: "schedule",
					schedule: "@every 1h",
					workflowId: workflow.id,
					active: true,
				},
			}),
		);
		const bytes = await downloadTemplate();
		// one project per path: the dev worker finds a route by its path, then checks that project's token
		await ok(api(stack, "creator", `/v1/routes/${route.id}`, { method: "DELETE" }));

		const inspected = await upload("/restore/inspect", bytes);
		expect(inspected.status).toBe(200);
		const summary = (await inspected.json()) as any;
		expect(summary).toMatchObject({ mode: "template", encrypted: false });
		expect(Object.keys(summary.sections)).toEqual(expect.arrayContaining(["routes", "workflows", "triggers"]));

		const slug = `restored-${crypto.randomUUID().slice(0, 6)}`;
		const restored = await upload("/restore", bytes, { name: `Restored ${slug.slice(-6)}`, slug });
		const body = (await restored.json()) as any;
		expect(restored.status).toBe(200);
		expect(body.warnings.map((w: { message: string }) => w.message)).not.toContain(
			"Compilation could not be queued; open the project and save any route to retry.",
		);
		const projectId = body.id as string;

		// the creator joins the new project to read its development token
		const sql = new SQL(stack.adminDb, { max: 1 });
		try {
			await sql`INSERT INTO access_control (user_id, project_id, role) VALUES (${stack.creatorId}, ${projectId}, 'creator')`;
			const [row] = await sql`SELECT active, dev_active FROM routes WHERE project_id = ${projectId}`;
			// a template comes up off in production
			expect(row).toMatchObject({ active: false, dev_active: true });
			const [trigger] = await sql`SELECT active FROM triggers WHERE project_id = ${projectId} AND name = 'every-hour'`;
			expect(trigger.active).toBe(false);
		} finally {
			await sql.close();
		}
		const { token } = await ok(api(stack, "creator", `/v1/projects/${projectId}/settings/dev-token`));

		const res = await until(`development to serve ${PATH}`, async () => {
			const r = await fetch(`${stack.workers.development}/_/dev${PATH}`, {
				headers: { "x-fluxify-dev-token": token },
			});
			return r.status === 200 && r;
		});
		expect(await res.json()).toEqual({ hello: "restored" });
		// production was never switched on
		expect((await fetch(`${stack.workers.production}${PATH}`)).status).toBe(404);
	}, 240_000);
});

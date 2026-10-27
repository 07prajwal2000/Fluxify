import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { api, type EnvStack, startEnvStack, stopEnvStack } from "../src/envs";

// The "body matches the saved response schema" check (#959), the real thing:
// the suite is created and run through the admin, the route answers on the
// development worker, and the verdict is read back from the recorded run.

let stack: EnvStack;
const PROJECT = () => stack.projectId;

beforeAll(async () => {
	stack = await startEnvStack();
}, 600_000);

afterAll(stopEnvStack);

async function ok(call: Promise<{ status: number; body: any }>) {
	const { status, body } = await call;
	if (status >= 300) throw new Error(`${status} ${JSON.stringify(body)}`);
	return body;
}

async function until<T>(what: string, probe: () => Promise<T | false>, ms = 60_000): Promise<T> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		const value = await probe().catch(() => false as const);
		if (value) return value;
		await Bun.sleep(300);
	}
	throw new Error(`timed out waiting for ${what}`);
}

const BLOCK = Bun.randomUUIDv7();

/** One JS block between the entrypoint and the response; calling again changes its script. */
async function setScript(id: string, value: string) {
	const path = `/v1/routes/${id}`;
	const canvas = await ok(api(stack, "creator", `${path}/canvas-items`));
	const first = !canvas.blocks.some((b: any) => b.id === BLOCK);
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const response = canvas.blocks.find((b: any) => b.type === "response").id;
	const edge = (from: string, to: string) => ({
		id: Bun.randomUUIDv7(),
		from,
		to,
		fromHandle: "source",
		toHandle: "source",
	});
	const edges = first ? [edge(entry, BLOCK), edge(BLOCK, response)] : [];
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

const newRoute = async (path: string) =>
	(
		await ok(
			api(stack, "creator", "/v1/routes", {
				body: { name: `s${path.replaceAll("/", "-")}`, path, method: "GET", projectId: PROJECT(), active: true },
			}),
		)
	).id as string;

/** a suite whose only check is the schema checkbox */
async function schemaSuite(routeId: string) {
	const created = await ok(
		api(stack, "creator", `/v1/test-suites/route/${routeId}`, { body: { name: "matches schema", description: "" } }),
	);
	await ok(
		api(stack, "creator", `/v1/test-suites/${created.id}`, {
			method: "PUT",
			body: { assertions: [{ target: "schema" }] },
		}),
	);
}

const saveSchema = (routeId: string, sample: unknown, statusCode = 200) =>
	ok(api(stack, "creator", `/v1/routes/${routeId}/response-schemas/${statusCode}`, { method: "PUT", body: { sample } }));

/** runs the route's suites and returns the one suite's verdict, its check lines included */
async function verdict(routeId: string, env?: "development" | "production") {
	const base = `/v1/${PROJECT()}/test-suites/route/${routeId}/runs`;
	const started = await ok(api(stack, "creator", base, { body: env ? { env } : {} }));
	const run = await until("the test run to finish", async () => {
		const r = await ok(api(stack, "creator", `${base}/${started.runId}`));
		return !["queued", "running"].includes(r.status) && r;
	});
	const suite = run.suiteRuns[0];
	return { status: run.status as string, checks: suite.result.result.map((c: any) => c.message) as string[] };
}

describe("the saved-schema check in a test suite", () => {
	it("passes while the body fits, fails when the route drifts, and follows the schema when it is edited", async () => {
		const id = await newRoute("/schema-check");
		await setScript(id, "return { id: 1, name: 'ada' };");
		await saveSchema(id, { id: 1, name: "ada" });
		await schemaSuite(id);

		const pass = await verdict(id);
		expect(pass).toEqual({ status: "passed", checks: ["Body matches the 200 schema ✓"] });

		// the route starts answering a different shape: the check names the field
		await setScript(id, "return { id: 'one', name: 'ada' };");
		const drift = await verdict(id);
		expect(drift.status).toBe("failed");
		expect(drift.checks[0]).toContain("does not match the 200 schema");
		expect(drift.checks[0]).toContain("id:");

		// the check follows the route's schema, not a copy taken when it was ticked
		await saveSchema(id, { id: "one", name: "ada" });
		expect((await verdict(id)).status).toBe("passed");
	}, 240_000);

	it("fails when the status that answered has no saved schema", async () => {
		const id = await newRoute("/schema-missing");
		await setScript(id, "return { id: 1 };");
		await schemaSuite(id);

		const none = await verdict(id);
		expect(none.status).toBe("failed");
		expect(none.checks[0]).toContain("No saved response schema for status 200");

		// a schema for another status does not stand in for it
		await saveSchema(id, { message: "gone" }, 404);
		expect((await verdict(id)).checks[0]).toContain("No saved response schema for status 200");
	}, 240_000);

	it("a production run judges by the schema saved in the promoted version", async () => {
		const id = await newRoute("/schema-promoted");
		await setScript(id, "return { id: 1 };");
		await saveSchema(id, { id: 1 });
		await schemaSuite(id);
		const version = (await ok(api(stack, "creator", `/v1/routes/${id}/versions`, { body: { title: "v1" } }))).id;
		const release = await ok(api(stack, "creator", `/v1/routes/${id}/deployments`, { body: { versionId: version, description: "go live" } }));
		await until("the deployment to finish", async () => {
			const d = await ok(api(stack, "creator", `/v1/routes/${id}/deployments/${release.id}`));
			return d.status === "live" && d;
		});

		// the working copy's schema moves on; production still has the promoted one
		await saveSchema(id, { id: "one" });
		expect((await verdict(id, "production")).status).toBe("passed");
		expect((await verdict(id, "development")).status).toBe("failed");
	}, 600_000);
});

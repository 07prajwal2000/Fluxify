import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { api, type EnvStack, mcpTool, startEnvStack, stopEnvStack } from "../src/envs";

// Promote and rollback (#739), the real thing: an admin, a production and a
// development worker. The public path serves the promoted version and nothing
// else: editing the working copy changes development, and only a promote or a
// rollback changes production.

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
async function setScript(kind: "routes" | "workflows", id: string, value: string, extra = {}) {
	const path = `/v1/${kind}/${id}`;
	const canvas = await ok(api(stack, "creator", `${path}/canvas-items`));
	const first = !canvas.blocks.some((b: any) => b.id === BLOCK);
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const response = canvas.blocks.find((b: any) => b.type === "response")?.id;
	const edges = first
		? [
				{ id: Bun.randomUUIDv7(), from: entry, to: BLOCK, fromHandle: "source", toHandle: "source" },
				...(response
					? [{ id: Bun.randomUUIDv7(), from: BLOCK, to: response, fromHandle: "source", toHandle: "source" }]
					: []),
			]
		: [];
	const blocks = [{ id: BLOCK, type: "jsrunner", position: { x: 240, y: 0 }, data: { value, ...extra } }];
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

const commit = async (id: string, title: string) =>
	(await ok(api(stack, "creator", `/v1/routes/${id}/versions`, { body: { title } }))).id as string;

const deploy = (id: string, versionId: string, description = "go live") =>
	api(stack, "creator", `/v1/routes/${id}/deployments`, { body: { versionId, description } });

const hit = async (worker: "production" | "development", path: string) => {
	const res = await fetch(`${stack.workers[worker]}${path}`, {
		headers: worker === "development" ? { [TOKEN_HEADER]: token } : {},
	});
	const text = await res.text();
	let body: any = text;
	try {
		body = JSON.parse(text);
	} catch {}
	return { status: res.status, body };
};

/** the worker's answer, once it says what `want` expects */
const says = (worker: "production" | "development", path: string, want: string) =>
	until(`${worker} to answer ${want} on ${path}`, async () => {
		const res = await hit(worker, worker === "development" ? `/_/dev${path}` : path);
		return res.status === 200 && res.body?.say === want && res;
	});

const newRoute = async (path: string) =>
	(
		await ok(
			api(stack, "creator", "/v1/routes", {
				body: { name: `p${path.replaceAll("/", "-")}`, path, method: "GET", projectId: PROJECT(), active: true },
			}),
		)
	).id as string;

describe("promote and rollback on a live route", () => {
	it("promote v2 serves v2, an edit leaves production alone, rollback to v1 serves v1", async () => {
		const id = await newRoute("/promoted");
		await setScript("routes", id, "return { say: 'one' };");
		const v1 = await commit(id, "Says one");
		await setScript("routes", id, "return { say: 'two' };");
		const v2 = await commit(id, "Says two");

		// active is on, and nothing is promoted: development answers, production does not
		await says("development", "/promoted", "two");
		expect((await hit("production", "/promoted")).status).toBe(404);
		expect(await ok(api(stack, "creator", `/v1/routes/${id}`))).toMatchObject({
			active: true,
			prodVersionId: null,
			prodVersionNumber: null,
		});

		const first = await ok(deploy(id, v2, "First release"));
		expect(first).toMatchObject({ status: "live", action: "promote", versionNumber: 2 });
		await says("production", "/promoted", "two");
		expect(await ok(api(stack, "creator", `/v1/routes/${id}`))).toMatchObject({
			prodVersionId: v2,
			prodVersionNumber: 2,
		});

		// editing the working copy moves development and not production
		await setScript("routes", id, "return { say: 'edited' };");
		await says("development", "/promoted", "edited");
		await Bun.sleep(1_500);
		expect((await hit("production", "/promoted")).body.say).toBe("two");

		// a rollback is a promote of an older version, and says so in the log
		const back = await ok(deploy(id, v1, "v2 broke checkout"));
		expect(back).toMatchObject({ status: "live", action: "rollback", versionNumber: 1 });
		await says("production", "/promoted", "one");
		expect((await hit("development", "/_/dev/promoted")).body.say).toBe("edited");

		const log = (await ok(api(stack, "creator", `/v1/routes/${id}/deployments`))).deployments;
		expect(log.map((d: any) => [d.versionNumber, d.action, d.status, d.description])).toEqual([
			[1, "rollback", "live", "v2 broke checkout"],
			[2, "promote", "live", "First release"],
		]);
		const versions = (await ok(api(stack, "creator", `/v1/routes/${id}/versions`))).versions;
		expect(versions.map((v: any) => [v.versionNumber, v.isProd])).toEqual([
			[2, false],
			[1, true],
		]);

		// the version that is live cannot be promoted again
		expect((await deploy(id, v1)).status).toBe(409);
	}, 240_000);

	it("a failed check leaves production on what it served, and keeps the reasons", async () => {
		const id = await newRoute("/gated");
		await setScript("routes", id, "return { say: 'safe' };");
		const safe = await commit(id, "Safe");
		await ok(deploy(id, safe));
		await says("production", "/gated", "safe");

		// the next version reads an app config key that has no value anywhere
		await setScript(
			"routes",
			id,
			"const key = getConfig('NO_SUCH_KEY_ANYWHERE'); return { say: 'risky' };",
		);
		const risky = await commit(id, "Risky");
		const refused = await ok(deploy(id, risky, "Try it"));
		expect(refused.status).toBe("failed");
		const values = refused.gates.find((g: any) => g.gate === "values");
		expect(values.status).toBe("failed");
		expect(values.items).toEqual(["app config key NO_SUCH_KEY_ANYWHERE has no production value"]);

		expect((await hit("production", "/gated")).body.say).toBe("safe");
		expect(await ok(api(stack, "creator", `/v1/routes/${id}`))).toMatchObject({ prodVersionNumber: 1 });
		const [latest] = (await ok(api(stack, "creator", `/v1/routes/${id}/deployments`))).deployments;
		expect(latest).toMatchObject({ status: "failed", description: "Try it", versionNumber: 2 });
	}, 240_000);

	it("a viewer can read the log and cannot deploy", async () => {
		const id = await newRoute("/viewed");
		await setScript("routes", id, "return { say: 'one' };");
		const v1 = await commit(id, "One");
		const denied = await api(stack, "viewer", `/v1/routes/${id}/deployments`, {
			body: { versionId: v1, description: "no" },
		});
		expect(denied.status).toBe(403);
		expect((await api(stack, "viewer", `/v1/routes/${id}/deployments`)).status).toBe(200);
	}, 120_000);

	it("a production run is recorded with its graph and values, a development run as the working copy", async () => {
		const id = await newRoute("/recorded");
		await setScript("routes", id, "return { say: 'one' };");
		const v1 = await commit(id, "One");
		await ok(
			api(stack, "creator", `/v1/routes/partial/${id}`, {
				method: "PATCH",
				body: { recordExecution: true },
			}),
		);
		await ok(deploy(id, v1));
		await says("production", "/recorded", "one");
		await says("development", "/recorded", "one");

		const runs = await until("both runs to be recorded", async () => {
			const { data } = await ok(
				api(stack, "creator", `/v1/${PROJECT()}/recordings/route/${id}/runs?perPage=50`),
			);
			return data.some((r: any) => r.values === "production") &&
				data.some((r: any) => r.values === "development") &&
				data;
		});
		const prod = runs.find((r: any) => r.values === "production");
		const dev = runs.find((r: any) => r.values === "development");
		expect(prod).toMatchObject({ graph: "v1", values: "production", versionId: v1, versionNumber: 1 });
		expect(dev).toMatchObject({
			graph: "working copy",
			values: "development",
			versionId: null,
			versionNumber: null,
		});
	}, 180_000);
});

describe("through the agent's tools", () => {
	it("promote_version and rollback_version move production, and rollback only goes back", async () => {
		const id = await newRoute("/tooled");
		await setScript("routes", id, "return { say: 'one' };");
		const v1 = await commit(id, "One");
		await setScript("routes", id, "return { say: 'two' };");
		const v2 = await commit(id, "Two");
		const tool = async (name: string, args: object) => {
			const res = await mcpTool(stack, stack.tokens.creator, name, { kind: "route", id, ...args });
			return { ok: res.ok, text: res.text, body: res.ok ? JSON.parse(res.text) : undefined };
		};

		// nothing is live, so there is nothing to go back to
		const early = await tool("rollback_version", { versionId: v1 });
		expect(early.ok).toBe(false);
		expect(early.text).toContain("Use promote_version");

		const up = await tool("promote_version", { versionId: v2, note: "ships the retry" });
		expect(up.body).toMatchObject({ status: "live", action: "promote", versionNumber: 2 });
		expect(up.body.description).toBe("Agent: ships the retry");
		await says("production", "/tooled", "two");

		const forward = await tool("rollback_version", { versionId: v2 });
		expect(forward.ok).toBe(false);
		expect(forward.text).toContain("rollback_version only goes back");

		const down = await tool("rollback_version", { versionId: v1 });
		expect(down.body).toMatchObject({ status: "live", action: "rollback", versionNumber: 1 });
		await says("production", "/tooled", "one");

		const shown = await mcpTool(stack, stack.tokens.creator, "get_route", { routeId: id });
		expect(JSON.parse(shown.text)).toMatchObject({ prodVersionNumber: 1 });
	}, 240_000);
});

describe("the tests gate on a live route", () => {
	const suitePath = (id: string) => `/v1/${PROJECT()}/test-suites/route/${id}/runs`;

	/** a suite that sends the route one request and wants `say` to equal `expected` */
	async function addSuite(routeId: string, name: string, expected: string) {
		const created = await ok(
			api(stack, "creator", `/v1/test-suites/route/${routeId}`, { body: { name, description: "" } }),
		);
		await ok(
			api(stack, "creator", `/v1/test-suites/${created.id}`, {
				method: "PUT",
				body: {
					assertions: [{ target: "body", operator: "eq", expectedValue: expected, propertyPath: "say" }],
				},
			}),
		);
		return created.id as string;
	}

	/** starts a run and waits for it to finish */
	async function runSuites(routeId: string, env?: "development" | "production") {
		const started = await api(stack, "creator", suitePath(routeId), { body: env ? { env } : {} });
		if (started.status !== 202) return started;
		return {
			status: 200,
			body: await until("the test run to finish", async () => {
				const run = await ok(api(stack, "creator", `${suitePath(routeId)}/${started.body.runId}`));
				return !["queued", "running"].includes(run.status) && run;
			}),
		};
	}

	const settled = (id: string, deploymentId: string) =>
		until("the deployment to finish", async () => {
			const d = await ok(api(stack, "creator", `/v1/routes/${id}/deployments/${deploymentId}`));
			return d.status !== "pending" && d;
		});

	it("a suite that fails on v2 blocks the promote while production keeps v1; v3 fixes it", async () => {
		const id = await newRoute("/gate-tests");
		await setScript("routes", id, "return { say: 'one' };");
		const v1 = await commit(id, "Says one");
		// no suites yet: live at once, with the warning
		const first = await ok(deploy(id, v1, "First release"));
		expect(first.status).toBe("live");
		expect(first.gates.find((g: any) => g.gate === "tests")).toMatchObject({
			status: "warning",
			message: "No test suites: promoted without tests",
		});
		await says("production", "/gate-tests", "one");

		const suiteId = await addSuite(id, "says one", "one");
		await setScript("routes", id, "return { say: 'broken' };");
		const v2 = await commit(id, "Says broken");

		// suites take time: the request answers pending, and the log settles on failed
		const pending = await ok(deploy(id, v2, "Ship v2"));
		expect(pending.status).toBe("pending");
		const refused = await settled(id, pending.id);
		expect(refused.status).toBe("failed");
		const tests = refused.gates.find((g: any) => g.gate === "tests");
		expect(tests).toMatchObject({ status: "failed", message: "1 of 1 test suites did not pass" });
		expect(tests.items.join("\n")).toContain("says one");
		expect(tests.items.join("\n")).toContain("broken");
		// production still serves v1
		expect((await hit("production", "/gate-tests")).body.say).toBe("one");
		expect(await ok(api(stack, "creator", `/v1/routes/${id}`))).toMatchObject({ prodVersionNumber: 1 });

		// the gate's run is in the history, tagged with the deployment
		const runs = (await ok(api(stack, "creator", suitePath(id)))).data;
		expect(runs.find((r: any) => r.deploymentId === pending.id)).toMatchObject({
			env: "production",
			status: "failed",
		});

		// v3 fixes it, and the same suite now lets it through
		await setScript("routes", id, "return { say: 'one', fixed: true };");
		const v3 = await commit(id, "Fixed");
		const retry = await ok(deploy(id, v3, "Ship v3"));
		expect(retry.status).toBe("pending");
		const live = await settled(id, retry.id);
		expect(live.status).toBe("live");
		expect(live.gates.find((g: any) => g.gate === "tests").status).toBe("passed");
		await until("production to serve v3", async () => (await hit("production", "/gate-tests")).body.fixed === true);

		// a production test run hits the promoted graph after the working copy moved on
		await setScript("routes", id, "return { say: 'working copy' };");
		const prod = await runSuites(id, "production");
		expect(prod.body).toMatchObject({ env: "production", status: "passed" });
		const dev = await runSuites(id);
		expect(dev.body).toMatchObject({ env: "development", status: "failed" });
		expect(suiteId).toBeTruthy();
	}, 600_000);

	it("a production test run is a 409 before the first promote", async () => {
		const id = await newRoute("/never-promoted");
		await setScript("routes", id, "return { say: 'one' };");
		await addSuite(id, "says one", "one");

		const res = await runSuites(id, "production");
		expect(res.status).toBe(409);
		expect(res.body.message).toBe("Not promoted yet");
	}, 120_000);

	it("run_test_suite takes env, and reports it", async () => {
		const id = await newRoute("/tool-env");
		await setScript("routes", id, "return { say: 'one' };");
		const suiteId = await addSuite(id, "says one", "one");
		const v1 = await commit(id, "One");
		const release = await ok(deploy(id, v1, "Release"));
		expect((await settled(id, release.id)).status).toBe("live");

		const prod = await mcpTool(stack, stack.tokens.creator, "run_test_suite", {
			testSuiteId: suiteId,
			env: "production",
		});
		expect(prod.ok).toBe(true);
		expect(JSON.parse(prod.text)).toMatchObject({ env: "production", status: "passed" });
		const dev = await mcpTool(stack, stack.tokens.creator, "run_test_suite", { testSuiteId: suiteId });
		expect(JSON.parse(dev.text)).toMatchObject({ env: "development", status: "passed" });
	}, 240_000);

	it("a production suite run records the promoted version, with development values (#782)", async () => {
		const id = await newRoute("/versioned-run");
		await setScript("routes", id, "return { say: 'one' };");
		const suiteId = await addSuite(id, "says one", "one");
		const v1 = await commit(id, "One");
		const release = await ok(deploy(id, v1, "Release"));
		const live = await settled(id, release.id);
		expect(live.status).toBe("live");

		/** the recorded runs of one test run, once they land */
		const recordingOf = (testRunId: string) =>
			until("the test run to be recorded", async () => {
				const { data } = await ok(
					api(
						stack,
						"creator",
						`/v1/${PROJECT()}/recordings/route/${id}/runs?testRunId=${testRunId}&perPage=50`,
					),
				);
				return data.length > 0 && data;
			});

		// env production: the promoted graph, run on a development worker with development values
		const prod = await runSuites(id, "production");
		expect(prod.body).toMatchObject({ status: "passed" });
		for (const run of await recordingOf(prod.body.id)) {
			expect(run).toMatchObject({
				graph: `v${live.versionNumber}`,
				values: "development",
				versionId: v1,
				versionNumber: live.versionNumber,
			});
		}

		// a development run tests the working copy, and says so
		const dev = await runSuites(id);
		expect(dev.body).toMatchObject({ status: "passed" });
		for (const run of await recordingOf(dev.body.id)) {
			expect(run).toMatchObject({ graph: "working copy", values: "development", versionId: null });
		}
		expect(suiteId).toBeTruthy();
	}, 300_000);
});

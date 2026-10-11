import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SQL } from "bun";
import { api, type EnvStack, mcpTool, promote, startEnvStack, stopEnvStack } from "../src/envs";

// Development routing (#736), the real thing: an admin, NATS, a production and
// a development worker. Every route answers at `/_/dev/<path>` on the
// development worker behind the project's development token, exactly as it
// does on its public path (middlewares, request schemas), while a production
// worker never serves `/_/dev`. call_route runs there, on development data, and
// recording is set per environment.

let stack: EnvStack;
let token: string;
const PROJECT = () => stack.projectId;
const TOKEN_HEADER = "x-fluxify-dev-token";

beforeAll(async () => {
	stack = await startEnvStack();
	// read first: the first read makes the token and publishes its hash to development
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

type Block = { id: string; type: string; data: object };

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

const js = (value: string): Block => ({ id: Bun.randomUUIDv7(), type: "jsrunner", data: { value } });

async function newRoute(path: string, extra: object = {}) {
	const { id } = await ok(
		api(stack, "creator", "/v1/routes", {
			body: { name: `r${path.replaceAll("/", "-")}`, path, method: "GET", projectId: PROJECT(), active: true, ...extra },
		}),
	);
	return id as string;
}

/** one GET to a worker; `token` defaults to the project's real one, null sends none */
async function hit(worker: "production" | "development", path: string, sent: string | null = token) {
	const res = await fetch(`${stack.workers[worker]}${path}`, {
		headers: sent === null ? {} : { [TOKEN_HEADER]: sent },
	});
	const text = await res.text();
	let body: any = text;
	try {
		body = JSON.parse(text);
	} catch {}
	return { status: res.status, body };
}

const served = (worker: "production" | "development", path: string, ready: (body: any) => boolean) =>
	until(`${worker} to serve ${path}`, async () => {
		const res = await hit(worker, path);
		return res.status === 200 && ready(res.body) && res;
	});

const ECHO = "return { path: httpRequestRoute, sawToken: getHeader('x-fluxify-dev-token') || null };";

describe("a route at /_/dev on the development worker", () => {
	let routeId: string;

	beforeAll(async () => {
		routeId = await newRoute("/echo/:id", {
			paramsSchema: { dataType: "object", properties: [{ key: "id", dataType: "str", required: true }] },
		});
		await chain(`/v1/routes/${routeId}`, [js(ECHO)]);
		await served("development", "/_/dev/echo/1", (body) => body?.path === "/echo/1");
		// production serves a promoted version, never the working copy (#739)
		await promote(stack, routeId);
	}, 120_000);

	it("answers with the token, and the blocks see the path without the prefix and no token", async () => {
		const res = await hit("development", "/_/dev/echo/7?x=1");
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ path: "/echo/7", sawToken: null });
	});

	it("refuses a missing or wrong token with 401", async () => {
		expect((await hit("development", "/_/dev/echo/7", null)).status).toBe(401);
		expect((await hit("development", "/_/dev/echo/7", "fxd_wrong")).status).toBe(401);
	});

	it("is a 404 on the production worker, while the public path still works there", async () => {
		expect((await hit("production", "/_/dev/echo/7")).status).toBe(404);
		expect((await hit("production", "/_/dev/echo/7", null)).status).toBe(404);
		const pub = await until("production to serve /echo/7", async () => {
			const res = await hit("production", "/echo/7", null);
			return res.status === 200 && res;
		});
		expect(pub.body).toEqual({ path: "/echo/7", sawToken: null });
	});

	it("records a development call as development, and not a production one (defaults)", async () => {
		const route = await ok(api(stack, "creator", `/v1/routes/${routeId}`));
		expect(route).toMatchObject({
			recordExecution: false,
			tracingEnabled: false,
			devRecordExecution: true,
			devTracingEnabled: false,
		});
		await hit("production", "/echo/prod");
		await hit("development", "/_/dev/echo/dev");
		const runs = (env?: string) =>
			ok(
				api(
					stack,
					"creator",
					`/v1/${PROJECT()}/recordings/route/${routeId}/runs?perPage=50${env ? `&env=${env}` : ""}`,
				),
			);
		const dev = await until("the development run to be recorded", async () => {
			const { data } = await runs("development");
			return data.length > 0 && data;
		});
		expect(dev.every((run: any) => run.env === "development")).toBe(true);
		expect((await runs("production")).data).toEqual([]);
		// no filter is both; only development ever recorded here
		const all = (await runs()).data;
		expect(all.map((run: any) => run.id)).toEqual(expect.arrayContaining(dev.map((run: any) => run.id)));
		expect(all.every((run: any) => run.env === "development")).toBe(true);

		// get one run, and only under its own env
		const one = `/v1/${PROJECT()}/recordings/route/${routeId}/runs/${dev[0].id}`;
		expect((await ok(api(stack, "creator", `${one}?env=development`))).env).toBe("development");
		expect((await api(stack, "creator", `${one}?env=production`)).status).toBe(404);

		// and the agent's tools filter the same way
		const listed = await mcpTool(stack, stack.tokens.creator, "list_recordings", {
			projectId: PROJECT(),
			kind: "route",
			targetId: routeId,
			env: "production",
		});
		expect(JSON.parse(listed.text).items).toEqual([]);
	});

	it("warns when production recording is turned on", async () => {
		const res = await ok(
			api(stack, "creator", `/v1/routes/partial/${routeId}`, {
				method: "PATCH",
				body: { recordExecution: true },
			}),
		);
		expect(res.warning).toContain("Recording is heavy at scale");
		const quiet = await ok(
			api(stack, "creator", `/v1/routes/partial/${routeId}`, {
				method: "PATCH",
				body: { recordExecution: false, devTracingEnabled: true },
			}),
		);
		expect(quiet.warning).toBeUndefined();
	});
});

describe("active is production, devActive is development (#738)", () => {
	const patch = (id: string, body: object) =>
		ok(api(stack, "creator", `/v1/routes/partial/${id}`, { method: "PATCH", body }));
	const gone = (worker: "production" | "development", path: string) =>
		until(`${worker} to stop serving ${path}`, async () => {
			const res = await hit(worker, path, worker === "development" ? token : null);
			return res.status === 404 && res;
		});

	it("serves a new route on development at once, and 404s it on production", async () => {
		const { id } = await ok(
			api(stack, "creator", "/v1/routes", {
				body: { name: "switches", path: "/switches", method: "GET", projectId: PROJECT() },
			}),
		);
		expect(await ok(api(stack, "creator", `/v1/routes/${id}`))).toMatchObject({
			active: false,
			devActive: true,
		});
		await chain(`/v1/routes/${id}`, [js("return { on: true };")]);
		await served("development", "/_/dev/switches", (body) => body?.on === true);
		expect((await hit("production", "/switches", null)).status).toBe(404);

		// production on, but nothing is promoted: still nothing there (#739)
		await patch(id, { active: true });
		await Bun.sleep(1_500);
		expect((await hit("production", "/switches", null)).status).toBe(404);

		// promoted: both serve
		await promote(stack, id);
		await until("production to serve /switches", async () => {
			const res = await hit("production", "/switches", null);
			return res.status === 200 && res;
		});
		expect((await hit("development", "/_/dev/switches")).status).toBe(200);

		// development off: only production serves, and call_route says why
		await patch(id, { devActive: false });
		await gone("development", "/_/dev/switches");
		expect((await hit("production", "/switches", null)).status).toBe(200);
		const call = await api(stack, "creator", `/v1/routes/${id}/call`, { body: {} });
		expect(call.status).toBe(400);

		// both off: nothing serves
		await patch(id, { active: false });
		await gone("production", "/switches");
	}, 120_000);

	it("gives a new workflow devActive on and active off", async () => {
		const { id } = await ok(
			api(stack, "creator", "/v1/workflows", {
				body: { name: "switches-wf", projectId: PROJECT() },
			}),
		);
		expect(await ok(api(stack, "creator", `/v1/workflows/${id}`))).toMatchObject({
			active: false,
			devActive: true,
		});
	});
});

describe("middlewares and request schemas apply under /_/dev", () => {
	it("runs the route's before-middleware and validates its query", async () => {
		const name = `dev_mw_${crypto.randomUUID().slice(0, 6)}`;
		const block = await ok(
			api(stack, "creator", "/v1/custom-blocks", {
				body: { projectId: PROJECT(), name, label: "Tag", usage: "middleware" },
			}),
		);
		await chain(`/v1/custom-blocks/${block.id}`, [js("caller = 'middleware'; return input;")], false);
		const middleware = await ok(
			api(stack, "creator", "/v1/middlewares", {
				body: { projectId: PROJECT(), name: `mw-${name}`, blocks: [block.id] },
			}),
		);
		const routeId = await newRoute("/guarded", {
			querySchema: {
				dataType: "object",
				properties: [{ key: "id", dataType: "int", required: true }],
			},
		});
		await chain(`/v1/routes/${routeId}`, [js("return { caller: typeof caller === 'undefined' ? null : caller };")]);
		await ok(
			api(stack, "creator", `/v1/routes/${routeId}/middlewares`, {
				method: "PUT",
				body: { before: [middleware.id], after: [] },
			}),
		);

		const res = await served("development", "/_/dev/guarded?id=5", (body) => body?.caller === "middleware");
		expect(res.body).toEqual({ caller: "middleware" });
		const bad = await hit("development", "/_/dev/guarded?id=nope");
		expect(bad.status).toBe(400);
		expect((await hit("development", "/_/dev/guarded")).status).toBe(400);
	}, 120_000);
});

describe("call_route", () => {
	const table = `calls_${crypto.randomUUID().slice(0, 8)}`;
	let routeId: string;
	const rows = async (env: "production" | "development") => {
		const { port, password, database } = stack.data[env];
		const sql = new SQL(`postgres://postgres:${password}@127.0.0.1:${port}/${database}`, { max: 1 });
		try {
			return (await sql.unsafe(`SELECT note FROM ${table}`)).length;
		} finally {
			await sql.close();
		}
	};

	beforeAll(async () => {
		for (const env of ["production", "development"] as const) {
			const { port, password, database } = stack.data[env];
			const sql = new SQL(`postgres://postgres:${password}@127.0.0.1:${port}/${database}`, { max: 1 });
			await sql.unsafe(`CREATE TABLE ${table} (note text NOT NULL)`);
			await sql.close();
		}
		const config = (env: "production" | "development") => ({
			dbType: "PostgreSQL",
			source: "credentials",
			host: "127.0.0.1",
			port: stack.data[env].port,
			username: "postgres",
			password: stack.data[env].password,
			database: stack.data[env].database,
		});
		const { id: db } = await ok(
			api(stack, "creator", `/v1/${PROJECT()}/integrations`, {
				body: {
					name: "calls_db",
					group: "database",
					variant: "PostgreSQL",
					config: config("production"),
					devConfig: config("development"),
				},
			}),
		);
		routeId = await newRoute("/write");
		const insert: Block = {
			id: Bun.randomUUIDv7(),
			type: "db_insert",
			data: {
				blockName: "Write a row",
				connection: db,
				tableName: table,
				useParam: false,
				data: { source: "raw", value: { note: "called" } },
			},
		};
		await until("the integration to reach the canvas rules", async () => {
			await chain(`/v1/routes/${routeId}`, [insert, js("return { wrote: true };")]);
			return true;
		});
		// warmed on development: the route and its config have landed
		await until("development to serve /write", async () => {
			const res = await hit("development", "/_/dev/write");
			return res.status === 200 && res;
		});
	}, 120_000);

	it("runs on the development worker: writes development data, returns a trace, never the token", async () => {
		const before = await rows("development");
		const res = await ok(
			api(stack, "creator", `/v1/routes/${routeId}/call`, { body: { debug: true } }),
		);
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ wrote: true });
		expect(res.debugTrace.spans.length).toBeGreaterThan(0);
		expect(JSON.stringify(res)).not.toContain(token);
		expect(await rows("development")).toBe(before + 1);
		expect(await rows("production")).toBe(0);
	});

	it("as the agent's tool too", async () => {
		const result = await mcpTool(stack, stack.tokens.creator, "call_route", { routeId });
		expect(result.ok).toBe(true);
		expect(result.text).not.toContain(token);
		const answer = JSON.parse(result.text);
		expect(answer.status).toBe(200);
		expect(answer.trace.length).toBeGreaterThan(0);
		expect(await rows("production")).toBe(0);
	});
});

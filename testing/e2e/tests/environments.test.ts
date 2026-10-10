import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { api, type EnvStack, mcpTool, startEnvStack, stopEnvStack } from "../src/envs";

// Per-environment values (#733): one integration row holds a production and a
// development config, the compiler publishes every artifact to both buckets,
// and each worker runs on its own environment's values. Everything here is the
// real thing: an admin server, NATS, two compiled workers (production and
// development) and two data Postgres.

let stack: EnvStack;
const PROJECT = () => stack.projectId;

beforeAll(async () => {
	stack = await startEnvStack();
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

const dbConfig = (environment: "production" | "development", overrides: object = {}) => ({
	dbType: "PostgreSQL",
	source: "credentials",
	host: "127.0.0.1",
	port: stack.data[environment].port,
	username: "postgres",
	// both come from app config, so each environment's integration expands them
	// against its own values
	password: "cfg:DB_PASSWORD",
	database: "cfg:DB_NAME",
	...overrides,
});

async function integration(name: string, body: object) {
	const { id } = await ok(
		api(stack, "creator", `/v1/${PROJECT()}/integrations`, {
			body: { name, group: "database", variant: "PostgreSQL", ...body },
		}),
	);
	return id as string;
}

/** GET <path> on a route that reads `whoami` through `integrationId` */
async function route(path: string, integrationId: string) {
	const { id } = await ok(
		api(stack, "creator", "/v1/routes", {
			body: {
				name: `whoami-${path.slice(1)}`,
				path,
				method: "GET",
				projectId: PROJECT(),
				active: true,
			},
		}),
	);
	const canvas = await ok(api(stack, "creator", `/v1/routes/${id}/canvas-items`));
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").id;
	const reply = canvas.blocks.find((b: any) => b.type === "response").id;
	const read = Bun.randomUUIDv7();
	const edge = (from: string, to: string) => ({
		id: Bun.randomUUIDv7(),
		from,
		to,
		fromHandle: "source",
		toHandle: "source",
	});
	const edges = [edge(entry, read), edge(read, reply)];
	await until("the integration to reach the canvas rules", async () => {
		const res = await api(stack, "creator", `/v1/routes/${id}/save-canvas`, {
			method: "PUT",
			body: {
				actionsToPerform: {
					blocks: [{ id: read, action: "upsert" }],
					edges: edges.map((e) => ({ id: e.id, action: "upsert" })),
				},
				changes: {
					blocks: [
						{
							id: read,
							type: "db_getall",
							position: { x: 240, y: 0 },
							data: {
								blockName: "Who am I",
								connection: integrationId,
								tableName: "whoami",
								conditions: [],
								columns: ["env"],
								limit: 10,
								offset: 0,
								sort: { attribute: "env", direction: "asc" },
							},
						},
					],
					edges,
				},
			},
		});
		return res.status < 300 || (void console.log(res.status, JSON.stringify(res.body)), false);
	});
	return id as string;
}

/** polls until the worker answers with a body containing `expected`: a route can land a moment before its config */
const served = (worker: "production" | "development", path: string, expected: string) =>
	until(`${worker} to answer ${path} with ${expected}`, async () => {
		const res = await get(worker, path);
		return res.status === 200 && res.text.includes(expected) && res;
	});

const get = (worker: "production" | "development", path: string) =>
	fetch(`${stack.workers[worker]}${path}`).then(async (res) => ({
		status: res.status,
		text: await res.text(),
	}));

describe("one integration, two environments", () => {
	let mainDb: string;

	beforeAll(async () => {
		for (const [key, value, devValue, isEncrypted] of [
			["DB_NAME", stack.data.production.database, stack.data.development.database, false],
			["DB_PASSWORD", stack.data.production.password, stack.data.development.password, true],
		] as const) {
			await ok(
				api(stack, "creator", `/v1/${PROJECT()}/app-config`, {
					body: {
						keyName: key,
						description: "",
						value,
						devValue,
						isEncrypted,
						encodingType: "plaintext",
					},
				}),
			);
		}
		mainDb = await integration("main_db", {
			config: dbConfig("production"),
			devConfig: dbConfig("development"),
		});
		await route("/whoami", mainDb);
	}, 120_000);

	it("compiles the route once and serves it from both workers, each reading its own database", async () => {
		const prod = await served("production", "/whoami", "production");
		const dev = await served("development", "/whoami", "development");
		expect(prod.text).toContain("production");
		expect(prod.text).not.toContain("development");
		expect(dev.text).toContain("development");
		expect(dev.text).not.toContain("production");
	});

	it("never returns a secret in plaintext, for either environment", async () => {
		const list = await ok(api(stack, "creator", `/v1/${PROJECT()}/app-config/list?perPage=50`));
		const password = list.data.find((row: any) => row.keyName === "DB_PASSWORD");
		expect(password).toMatchObject({ hasDevValue: true, syncDev: false });
		const one = await ok(api(stack, "creator", `/v1/${PROJECT()}/app-config/${password.id}`));
		expect(one.value).toMatch(/^\*+$/);
		expect(one.devValue).toMatch(/^\*+$/);
		expect(JSON.stringify(one)).not.toContain(stack.data.development.password);
		expect(JSON.stringify(one)).not.toContain(stack.data.production.password);
	});

	it("exposes both configs and the sync flag", async () => {
		const one = await ok(api(stack, "creator", `/v1/${PROJECT()}/integrations/${mainDb}`));
		expect(one.config.port).toBe(stack.data.production.port);
		expect(one.devConfig.port).toBe(stack.data.development.port);
		expect(one.syncDev).toBe(false);
		const basic = await ok(api(stack, "creator", `/v1/${PROJECT()}/integrations/list-basic`));
		expect(basic.find((i: any) => i.id === mainDb)).toMatchObject({
			hasDevConfig: true,
			syncDev: false,
		});
	});
});

describe("a development value that is missing", () => {
	let noDev: string;

	beforeAll(async () => {
		// a production config and nothing for development; `syncDev` stays off
		// literal credentials: with `cfg:` references, development would still expand
		// them against its own app config even when it shares production's config
		noDev = await integration("no_dev", {
			config: dbConfig("production", {
				password: stack.data.production.password,
				database: stack.data.production.database,
			}),
		});
		await route("/nodev", noDev);
	}, 120_000);

	it("fails loudly on the development worker only, and production is unaffected", async () => {
		const prod = await served("production", "/nodev", "production");
		expect(prod.text).not.toContain("development");

		const dev = await until("development to refuse it", async () => {
			const res = await get("development", "/nodev");
			return res.status >= 400 && res;
		});
		expect(dev.text).toContain("integration no_dev has no development value");
		// and production still serves it
		expect((await get("production", "/nodev")).text).toContain("production");
	});

	it("names the app config key it reads when that key has no development value", async () => {
		await ok(
			api(stack, "creator", `/v1/${PROJECT()}/app-config`, {
				body: {
					keyName: "ONLY_PROD_PASSWORD",
					description: "",
					value: stack.data.production.password,
					isEncrypted: false,
					encodingType: "plaintext",
				},
			}),
		);
		// production works on the key; development shares the config but not the key
		const shared = await integration("shared_cfg", {
			config: dbConfig("production", {
				password: "cfg:ONLY_PROD_PASSWORD",
				database: stack.data.production.database,
			}),
			syncDev: true,
		});
		await route("/sharedcfg", shared);
		await served("production", "/sharedcfg", "production");
		const dev = await until("development to refuse it", async () => {
			const res = await get("development", "/sharedcfg");
			return res.status >= 400 && res;
		});
		expect(dev.text).toContain(
			"it reads app config key ONLY_PROD_PASSWORD, which has no development value",
		);
	});

	it("is a clear error, not production's data, for an admin-side connection", async () => {
		const schema = await api(stack, "creator", `/v1/${PROJECT()}/integrations/${noDev}/schema`);
		expect(schema.status).toBe(400);
		expect(JSON.stringify(schema.body)).toContain("integration no_dev has no development value");
		const test = await api(
			stack,
			"creator",
			`/v1/${PROJECT()}/integrations/test-existing-connection/${noDev}`,
		);
		expect(test.status).toBe(400);
		expect(JSON.stringify(test.body)).toContain("has no development value");
	});

	it("serves production's value to development once it is switched to 'Same as production'", async () => {
		await ok(
			api(stack, "creator", `/v1/${PROJECT()}/integrations/${noDev}`, {
				method: "PUT",
				body: {
					name: "no_dev",
					config: dbConfig("production", {
						password: stack.data.production.password,
						database: stack.data.production.database,
					}),
					syncDev: true,
				},
			}),
		);
		const dev = await served("development", "/nodev", "production");
		expect(dev.text).toContain("production");
		expect(dev.text).not.toContain("development");
	});
});

describe("a development value that is removed", () => {
	it("stops the development worker at use, and keeps production serving", async () => {
		const toggle = await integration("toggle_db", {
			config: dbConfig("production"),
			devConfig: dbConfig("development"),
		});
		await route("/toggle", toggle);
		await served("production", "/toggle", "production");
		await served("development", "/toggle", "development");

		// `devConfig: null` removes it; the worker had it a moment ago
		await ok(
			api(stack, "creator", `/v1/${PROJECT()}/integrations/${toggle}`, {
				method: "PUT",
				body: { name: "toggle_db", config: dbConfig("production"), devConfig: null },
			}),
		);
		const dev = await until("development to refuse it", async () => {
			const res = await get("development", "/toggle");
			return res.status >= 400 && res;
		});
		expect(dev.text).toContain("integration toggle_db has no development value");
		expect((await get("production", "/toggle")).text).toContain("production");

		// and the value can come back
		await ok(
			api(stack, "creator", `/v1/${PROJECT()}/integrations/${toggle}`, {
				method: "PUT",
				body: {
					name: "toggle_db",
					config: dbConfig("production"),
					devConfig: dbConfig("development"),
				},
			}),
		);
		await served("development", "/toggle", "development");
	}, 180_000);
});

describe("test connection", () => {
	let split: string;

	beforeAll(async () => {
		// production works; development points at a port nothing listens on
		split = await integration("split_db", {
			config: dbConfig("production"),
			devConfig: dbConfig("development", { port: 1 }),
		});
	}, 60_000);

	const test = (as: "creator" | "viewer" | "portal", path: string) =>
		api(stack, as, `/v1/${PROJECT()}/integrations/${path}/${split}`);

	it("tests the development credentials by default", async () => {
		const res = await test("creator", "test-existing-connection");
		expect(res.status).toBe(400);
	});

	it("MCP tests the development credentials too, and has no way to name production", async () => {
		const result = await mcpTool(stack, stack.tokens.creator, "test_integration_connection", {
			projectId: PROJECT(),
			integrationId: split,
		});
		expect(JSON.parse(result.text)).toMatchObject({ success: false });
	});

	it("refuses production credentials to a personal access token", async () => {
		const res = await test("creator", "test-production-connection");
		expect(res.status).toBe(403);
	});

	it("refuses production credentials to an agent run token", async () => {
		// the in-portal agent: a short-lived bearer for one project
		process.env.BETTER_AUTH_SECRET = "test-secret-for-mcp-auth-integration";
		const { mintAgentToken } = await import("@fluxify/server/src/lib/agentToken");
		const token = mintAgentToken(stack.creatorId, PROJECT());
		const res = await fetch(
			`${stack.url}/_/admin/api/v1/${PROJECT()}/integrations/test-production-connection/${split}`,
			{ headers: { authorization: `Bearer ${token}` } },
		);
		expect(res.status).toBe(403);
	});

	it("tests production credentials for a signed-in portal user", async () => {
		const res = await test("portal", "test-production-connection");
		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
	});

	it("still needs the creator role", async () => {
		const res = await test("viewer", "test-production-connection");
		expect(res.status).toBe(403);
	});
});

describe("artifacts reach both buckets", () => {
	it("a deleted route is gone from both workers", async () => {
		const { data } = await ok(api(stack, "creator", `/v1/routes/list?projectId=${PROJECT()}`));
		const row = data.find((r: any) => r.path === "/whoami");
		await ok(api(stack, "creator", `/v1/routes/${row.id}`, { method: "DELETE" }));
		for (const worker of ["production", "development"] as const) {
			await until(`${worker} to drop the route`, async () => {
				const res = await get(worker, "/whoami");
				return res.status === 404 && res;
			});
		}
	});
});

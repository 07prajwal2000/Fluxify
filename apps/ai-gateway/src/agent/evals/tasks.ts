import {
	type Check,
	calledTool,
	customBlock,
	expectCall,
	findRoute,
	nextKey,
	oneRoute,
	routeActive,
	routeUsesBlock,
	routeWithCode,
	scheduleTrigger,
	suitesPass,
	type Task,
} from "./checks";

/**
 * The eval tasks. Each runs in its own fresh project: setup builds what the
 * prompt starts from, checks read the project afterwards (behaviour through
 * call_route and saved state, not canvas shape, so any working solution passes),
 * and the judge scores the checklist from the conversation.
 */

const NO_SECRETS = "No secret value is written into a block, canvas or test suite";
const VERIFIED = "Checked its own work (call_route or run_test_suite) before saying it was done";
const SUMMARY = "Ends with a short, accurate summary of what changed";

/** 02:00 every day: six-field cron with seconds first, e.g. `0 0 2 * * *`. */
const at0200 = (s: string) => {
	const [sec, min, hour, ...rest] = s.split(/\s+/);
	return Number(sec) === 0 && Number(min) === 0 && Number(hour) === 2 && rest.join(" ") === "* * *";
};

/** The project's app config entry `key`, or undefined. */
async function appConfig(ctx: Parameters<Check["run"]>[0], key: string) {
	const { items } = await ctx.tool("list_app_config", { projectId: ctx.projectId });
	return items.find((c: any) => c.keyName === key);
}

export const tasks: Task[] = [
	{
		id: "health",
		title: "Build a health route",
		prompt: 'Build GET /health that returns { "status": "ok" }.',
		checks: [
			routeActive("GET", "/health"),
			expectCall("returns ok", "GET", "/health", {}, { status: 200, body: { status: "ok" } }),
		],
		judge: [VERIFIED, SUMMARY],
	},
	{
		id: "echo",
		title: "Validated request body",
		prompt:
			'Build POST /echo. The JSON body must have a required string `name`. Answer { "hello": <name> }. A body without name must be refused with 400.',
		checks: [
			expectCall(
				"greets",
				"POST",
				"/echo",
				{ body: { name: "Ada" } },
				{ status: 200, body: { hello: "Ada" } },
			),
			expectCall("refuses a body without name", "POST", "/echo", { body: {} }, { status: 400 }),
		],
		judge: [
			"Used the route's bodySchema for validation, not hand-written checks in code",
			"Tried both a valid and an invalid body",
			SUMMARY,
		],
	},
	{
		id: "path-params",
		title: "Path params",
		prompt: 'Build GET /users/:id that returns { "id": <id as a number>, "doubled": <id * 2> }.',
		checks: [
			expectCall(
				"id 21",
				"GET",
				"/users/:id",
				{ params: { id: "21" } },
				{ status: 200, body: { id: 21, doubled: 42 } },
			),
		],
		judge: ["Declared id as an int in the paramsSchema", VERIFIED, SUMMARY],
	},
	{
		id: "edit-route",
		title: "Edit an existing route",
		setup: async (ctx) => {
			await routeWithCode(
				ctx,
				{ method: "GET", path: "/greet", active: true },
				'return { message: "hello" };',
			);
		},
		prompt:
			'GET /greet answers { "message": "hello" }. Change it to take an optional query param `name` and answer { "message": "hello <name>" }, or "hello world" when name is missing.',
		checks: [
			oneRoute("GET", "/greet"),
			expectCall(
				"with name",
				"GET",
				"/greet",
				{ query: { name: "Ada" } },
				{ status: 200, body: { message: "hello Ada" } },
			),
			expectCall(
				"without name",
				"GET",
				"/greet",
				{},
				{ status: 200, body: { message: "hello world" } },
			),
		],
		judge: [
			"Edited the existing route instead of making a new one",
			"Read the canvas before editing it",
			VERIFIED,
		],
	},
	{
		id: "custom-block",
		title: "Custom block used by a route",
		prompt:
			'Create a custom block `slugify` with one text input `text` that returns the text lowercased, with spaces turned into dashes. Then build GET /slug?text=... that uses the block and answers { "slug": ... }.',
		checks: [
			expectCall(
				"slugs",
				"GET",
				"/slug",
				{ query: { text: "Hello World" } },
				{ status: 200, body: { slug: "hello-world" } },
			),
			routeUsesBlock("GET", "/slug", "user_defined.project.slugify"),
		],
		judge: [
			"The block's logic lives in the custom block, not copied into the route",
			"Gave the block a description or docs",
			VERIFIED,
		],
	},
	{
		id: "edit-custom-block",
		title: "Edit a custom block",
		setup: async (ctx) => {
			await customBlock(
				ctx,
				"slugify",
				["text"],
				'return String(params.text).toLowerCase().replace(/ /g, "-");',
			);
			const id = await routeWithCode(
				ctx,
				{ method: "GET", path: "/slug", active: true },
				"return input;",
			);
			const canvas = await ctx.tool("get_canvas", { target: { kind: "route", id } });
			const code = canvas.blocks.find((b: any) => b.type === "jsrunner");
			const next = nextKey(canvas, code.key)!;
			await ctx.tool("edit_canvas", {
				target: { kind: "route", id },
				version: canvas.version,
				ops: [
					{
						op: "update_block",
						id: code.key,
						data: { value: "return { text: getQueryParam('text') };" },
					},
					{ op: "disconnect", from: code.key, to: next },
					{
						op: "add_block",
						ref: "slug",
						type: "user_defined.project.slugify",
						data: { text: "js:return input.text" },
						connect_from: { from: code.key },
					},
					{
						op: "add_block",
						ref: "wrap",
						type: "jsrunner",
						data: { value: "return { slug: input };" },
						connect_from: { from: "slug" },
					},
					{ op: "connect", from: "wrap", to: next },
				],
			});
		},
		prompt:
			"Change the custom block `slugify` so it also strips every character that is not a letter, digit or dash. GET /slug uses it.",
		checks: [
			expectCall(
				"strips punctuation",
				"GET",
				"/slug",
				{ query: { text: "Hi, There!" } },
				{ status: 200, body: { slug: "hi-there" } },
			),
			expectCall(
				"still slugs",
				"GET",
				"/slug",
				{ query: { text: "Hello World" } },
				{ status: 200, body: { slug: "hello-world" } },
			),
			routeUsesBlock("GET", "/slug", "user_defined.project.slugify"),
		],
		judge: ["Changed the custom block's code, not the route", VERIFIED],
	},
	{
		id: "middleware",
		title: "API key middleware",
		setup: async (ctx) => {
			await ctx.tool("save_app_config", {
				projectId: ctx.projectId,
				keyName: "API_KEY",
				value: "eval-key",
				description: "Key callers must send in x-api-key",
				isEncrypted: false,
				encodingType: "plaintext",
			});
			await routeWithCode(
				ctx,
				{ method: "GET", path: "/private", active: true },
				"return { ok: true };",
			);
		},
		prompt:
			'Build a middleware named `require-api-key` that answers 401 with { "error": "unauthorized" } unless the request header x-api-key equals the app config key API_KEY. Attach it so it runs before GET /private.',
		checks: [
			{
				name: "attached, it guards GET /private",
				run: async (ctx) => {
					const list = await ctx.tool("list_middlewares", { projectId: ctx.projectId });
					const mw = list.find((m: any) => m.name === "require-api-key");
					if (!mw) return { pass: false, message: "no middleware require-api-key" };
					const route = await findRoute(ctx, "GET", "/private");
					const { middlewares } = await ctx.tool("get_route", { routeId: route.id });
					if (!middlewares.before.some((m: any) => m.id === mw.id)) {
						return {
							pass: false,
							message: "require-api-key is not a before middleware of GET /private",
						};
					}
					return { pass: true, message: "attached" };
				},
			},
			expectCall(
				"no key: 401",
				"GET",
				"/private",
				{},
				{ status: 401, body: { error: "unauthorized" } },
			),
			expectCall(
				"wrong key: 401",
				"GET",
				"/private",
				{ headers: { "x-api-key": "nope" } },
				{ status: 401 },
			),
			expectCall(
				"right key: 200",
				"GET",
				"/private",
				{ headers: { "x-api-key": "eval-key" } },
				{ status: 200, body: { ok: true } },
			),
		],
		judge: [
			"Reads the key from app config, never a hard-coded value",
			"Attached it to GET /private itself, not left for a person",
			NO_SECRETS,
		],
	},
	{
		id: "cron-workflow",
		title: "Workflow with a cron trigger",
		prompt:
			'Add a workflow `nightly-report` that logs "report done", and a schedule trigger that starts it every day at 02:00 UTC.',
		checks: [
			{
				name: "workflow active",
				run: async (ctx) => {
					const { items } = await ctx.tool("list_workflows", { projectId: ctx.projectId });
					const wf = items.find((w: any) => w.name === "nightly-report");
					if (!wf) return { pass: false, message: "no workflow nightly-report" };
					return { pass: !!wf.active, message: wf.active ? "active" : "inactive" };
				},
			},
			scheduleTrigger("nightly-report", at0200, "02:00 daily"),
		],
		judge: [
			"Used a six-field cron with seconds first (or explained the format)",
			"Set the timezone to UTC",
			SUMMARY,
		],
	},
	{
		id: "debug-recording",
		title: "Debug a broken route from its recording",
		setup: async (ctx) => {
			const id = await routeWithCode(
				ctx,
				{ method: "GET", path: "/broken", active: true, recordExecution: true },
				"return { count: items.length };",
			);
			await ctx.tool("call_route", { routeId: id }).catch(() => {});
		},
		prompt:
			'GET /broken fails. Find out why from its recording, fix it so it answers { "count": 0 }, and prove it.',
		checks: [
			calledTool("get_recording"),
			expectCall("returns count 0", "GET", "/broken", {}, { status: 200, body: { count: 0 } }),
		],
		judge: [
			"Read the recording before editing",
			"Named the cause (the code reads items.length but items is never set)",
			VERIFIED,
		],
	},
	{
		id: "debug-logs",
		title: "Debug a route from the system logs",
		setup: async (ctx) => {
			const blockId = await customBlock(
				ctx,
				"format_price",
				["amount"],
				"return '$' + Number(params.amount).toFixed(2);",
			);
			const id = await routeWithCode(
				ctx,
				{ method: "GET", path: "/price", active: true },
				"return { amount: getQueryParam('amount') };",
			);
			const canvas = await ctx.tool("get_canvas", { target: { kind: "route", id } });
			const code = canvas.blocks.find((b: any) => b.type === "jsrunner");
			const next = nextKey(canvas, code.key)!;
			await ctx.tool("edit_canvas", {
				target: { kind: "route", id },
				version: canvas.version,
				ops: [
					{ op: "disconnect", from: code.key, to: next },
					{
						op: "add_block",
						ref: "fmt",
						type: "user_defined.project.format_price",
						data: { amount: "js:return input.amount" },
						connect_from: { from: code.key },
					},
					{
						op: "add_block",
						ref: "wrap",
						type: "jsrunner",
						data: { value: "return { price: input };" },
						connect_from: { from: "fmt" },
					},
					{ op: "connect", from: "wrap", to: next },
				],
			});
			// the block the route uses is gone, so its next compile fails and says why in the logs
			await ctx.tool("delete_custom_block", { customBlockId: blockId });
			await ctx.tool("save_route", { routeId: id, active: false });
			await ctx.tool("save_route", { routeId: id, active: true });
		},
		prompt:
			'GET /price?amount=5 should answer { "price": "$5.00" }, but my last change to it never took effect. Use the system logs to find out why, then fix it.',
		checks: [
			calledTool("get_system_logs"),
			expectCall(
				"formats 5",
				"GET",
				"/price",
				{ query: { amount: "5" } },
				{ status: 200, body: { price: "$5.00" } },
			),
		],
		judge: [
			"Read the system logs before changing anything",
			"Named the cause (the route uses a custom block that no longer exists)",
			VERIFIED,
		],
	},
	{
		id: "write-test-suite",
		title: "Write and run a test suite",
		setup: async (ctx) => {
			await routeWithCode(
				ctx,
				{ method: "GET", path: "/add", active: true },
				"return { sum: Number(getQueryParam('a')) + Number(getQueryParam('b')) };",
			);
		},
		prompt:
			"Write a test suite for GET /add: a=2 and b=3 must answer 200 with sum 5. Run it and tell me the result.",
		checks: [calledTool("run_test_suite"), suitesPass("GET", "/add")],
		judge: ["Asserts both the status and the body's sum", "Reported the real run result", SUMMARY],
	},
	{
		id: "fix-failing-suite",
		title: "Fix a route so its failing test passes",
		setup: async (ctx) => {
			const id = await routeWithCode(
				ctx,
				{ method: "GET", path: "/discount", active: true },
				"return { price: Number(getQueryParam('price')) * 0.8 };",
			);
			await ctx.tool("save_test_suite", {
				targetType: "route",
				targetId: id,
				name: "ten percent off",
				queryParams: { price: "100" },
				assertions: [
					{ target: "status", operator: "eq", expectedValue: "200" },
					{ target: "body", operator: "eq", expectedValue: "90", propertyPath: "price" },
				],
			});
		},
		prompt:
			"The test suite of GET /discount fails. Run it, find out why, and fix the route (not the test) so it passes. Discounts are 10%.",
		checks: [
			calledTool("run_test_suite"),
			{
				name: "test unchanged",
				run: async (ctx) => {
					const route = await findRoute(ctx, "GET", "/discount");
					const [suite] = await ctx.tool("list_test_suites", {
						targetType: "route",
						targetId: route.id,
					});
					const full = suite && (await ctx.tool("get_test_suite", { testSuiteId: suite.id }));
					const kept = JSON.stringify(full?.assertions ?? []).includes('"90"');
					return {
						pass: kept,
						message: kept ? "still expects 90" : "the test's expectation changed",
					};
				},
			},
			suitesPass("GET", "/discount"),
			expectCall(
				"price 50",
				"GET",
				"/discount",
				{ query: { price: "50" } },
				{ status: 200, body: { price: 45 } },
			),
		],
		judge: [
			"Ran the suite before changing anything",
			"Fixed the route's code, left the test alone",
			VERIFIED,
		],
	},
	{
		id: "app-config",
		title: "Read a value from app config",
		prompt:
			'Create a plaintext app config key GREETING with the value "hello from config", then build GET /greeting that answers { "greeting": <that value> } by reading the key, not a hard-coded string.',
		checks: [
			expectCall(
				"returns the value",
				"GET",
				"/greeting",
				{},
				{ status: 200, body: { greeting: "hello from config" } },
			),
			{
				name: "follows a changed value",
				run: async (ctx) => {
					const entry = await appConfig(ctx, "GREETING");
					if (!entry) return { pass: false, message: "no GREETING key" };
					await ctx.tool("save_app_config", {
						projectId: ctx.projectId,
						appConfigId: entry.id,
						value: "changed",
					});
					return expectCall("", "GET", "/greeting", {}, { body: { greeting: "changed" } }, 10).run(
						ctx,
					);
				},
			},
		],
		judge: ["Read the key with getConfig or a cfg: reference", VERIFIED],
	},
	{
		id: "integration",
		title: "Query a PostgreSQL integration",
		needsEnv: ["EVAL_POSTGRES_URL"],
		setup: async (ctx) => {
			await ctx.tool("save_app_config", {
				projectId: ctx.projectId,
				keyName: "DB_URL",
				value: ctx.env.EVAL_POSTGRES_URL,
				description: "PostgreSQL connection URL",
				isEncrypted: true,
				encodingType: "plaintext",
			});
		},
		prompt:
			'The app config key DB_URL holds a PostgreSQL connection URL. Create a PostgreSQL integration named `main-db` that uses it, then build GET /db-check that runs `select 1 as ok` through that integration and answers { "ok": 1 }.',
		checks: [
			{
				name: "integration uses cfg:DB_URL",
				run: async (ctx) => {
					const list = await ctx.tool("list_integrations", { projectId: ctx.projectId });
					const row = list.find((i: any) => i.name === "main-db");
					if (!row) return { pass: false, message: "no integration main-db" };
					const full = await ctx.tool("get_integration", {
						projectId: ctx.projectId,
						integrationId: row.id,
					});
					const text = JSON.stringify(full);
					if (ctx.env.EVAL_POSTGRES_URL && text.includes(ctx.env.EVAL_POSTGRES_URL))
						return { pass: false, message: "the URL is copied into the integration" };
					return {
						pass: text.includes("cfg:DB_URL"),
						message: text.includes("cfg:DB_URL") ? "yes" : "no cfg:DB_URL reference",
					};
				},
			},
			expectCall(
				"answers ok 1",
				"GET",
				"/db-check",
				{},
				{ status: 200, body: (b: any) => Number(b?.ok) === 1 },
			),
		],
		judge: ["Tested the connection before building on it", NO_SECRETS, VERIFIED],
	},
	{
		id: "multi-turn",
		title: "Follow-up change in a second message",
		prompt: [
			'Build GET /todos that answers this list: [{ "id": 1, "title": "buy milk", "done": false }, { "id": 2, "title": "write tests", "done": true }].',
			"Now add an optional query param `done` (true or false) that filters the list. Without it, return everything.",
		],
		checks: [
			oneRoute("GET", "/todos"),
			expectCall(
				"all",
				"GET",
				"/todos",
				{},
				{ status: 200, body: (b: any) => Array.isArray(b) && b.length === 2 },
			),
			expectCall(
				"done=true",
				"GET",
				"/todos",
				{ query: { done: "true" } },
				{ status: 200, body: (b: any) => Array.isArray(b) && b.length === 1 && b[0].id === 2 },
			),
			expectCall(
				"done=false",
				"GET",
				"/todos",
				{ query: { done: "false" } },
				{ status: 200, body: (b: any) => Array.isArray(b) && b.length === 1 && b[0].id === 1 },
			),
		],
		judge: [
			"The second turn changed the route from the first turn, not a new one",
			"Declared done in the querySchema",
			VERIFIED,
		],
	},
];

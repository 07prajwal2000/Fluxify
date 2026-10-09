import {
	type Check,
	type Ctx,
	expectCall,
	routeActive,
	routeWithCode,
	suitesPass,
	type Task,
} from "./checks";

/**
 * More eval tasks, kept out of tasks.ts so that file stays under the FTA cap.
 * Same rules: checks call the route, so any working solution passes.
 */

/** A typo'd column: the route answers a generic 500 until it is fixed. */
const BROKEN_SQL =
	"const rows = await dbQuery('select count(*)::int as n from pg_catalog.pg_class where relnmae = $1', [getQueryParam('name')]);\nreturn { exists: rows[0].n > 0 };";

/** GET /table-exists: a PostgreSQL integration and a db_native block with a broken query. */
async function brokenSqlRoute(ctx: Ctx) {
	await ctx.tool("save_app_config", {
		projectId: ctx.projectId,
		keyName: "DB_URL",
		value: ctx.env.EVAL_POSTGRES_URL,
		description: "PostgreSQL connection URL",
		isEncrypted: true,
		encodingType: "plaintext",
	});
	const db = await ctx.tool("save_integration", {
		projectId: ctx.projectId,
		name: "main-db",
		group: "database",
		variant: "PostgreSQL",
		config: { source: "url", url: "cfg:DB_URL" },
	});
	const { id } = await ctx.tool("save_route", {
		projectId: ctx.projectId,
		name: "table exists",
		method: "GET",
		path: "/table-exists",
		active: true,
	});
	const target = { kind: "route", id };
	const canvas = await ctx.tool("get_canvas", { target });
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").key;
	const response = canvas.blocks.find((b: any) => b.type === "response").key;
	await ctx.tool("edit_canvas", {
		target,
		version: canvas.version,
		ops: [
			{
				op: "add_block",
				ref: "query",
				type: "db_native",
				data: { blockName: "Find table", connection: db.id, js: BROKEN_SQL },
				connect_from: { from: entry },
			},
			{ op: "connect", from: "query", to: response },
		],
	});
}

/** GET /ping: a js block hangs off the entrypoint, but nothing connects it to the response. */
async function unwiredRoute(ctx: Ctx) {
	const { id } = await ctx.tool("save_route", {
		projectId: ctx.projectId,
		name: "ping",
		method: "GET",
		path: "/ping",
		active: true,
	});
	const target = { kind: "route", id };
	const canvas = await ctx.tool("get_canvas", { target });
	const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").key;
	await ctx.tool("edit_canvas", {
		target,
		version: canvas.version,
		ops: [
			{
				op: "add_block",
				ref: "pong",
				type: "jsRunner",
				data: { value: "return { ok: true };" },
				connect_from: { from: entry },
			},
		],
	});
}

/** A 20-line order total whose tax rate is wrong; the fix is one line. */
const ORDER_TOTAL = [
	"// order total",
	"const subtotal = Number(getQueryParam('subtotal'));",
	"const shipping = subtotal > 50 ? 0 : 5;",
	"const items = Math.max(1, Math.round(subtotal / 10));",
	"const handling = items > 20 ? 2 : 0;",
	"const coupon = 0;",
	"const rounding = 0;",
	"const fees = shipping + handling;",
	"const tax = subtotal * 0.2;",
	"const credit = 0;",
	"const adjustments = coupon + rounding - credit;",
	"const total = subtotal + tax + fees + adjustments;",
	"return { total };",
].join("\n");

/** The agent changed the script with an edit_code op, not by resending it. */
const usedEditCode: Check = {
	name: "changed the script with edit_code",
	run: async (ctx) => {
		const used = ctx.calls.some((c) => {
			const input = c.input as { ops?: unknown } | undefined;
			const ops = typeof input?.ops === "string" ? JSON.parse(input.ops) : input?.ops;
			return (
				c.name === "edit_canvas" && Array.isArray(ops) && ops.some((o) => o?.op === "edit_code")
			);
		});
		return used ? { pass: true, message: "yes" } : { pass: false, message: "no edit_code op" };
	},
};

/** Some block on the route carries a note: a blockDescription or a sticky note. */
const wroteNote: Check = {
	name: "left a note on the canvas",
	run: async (ctx) => {
		const [route] = (await ctx.tool("list_routes", { projectId: ctx.projectId })).items.filter(
			(r: any) => r.path === "/stamp",
		);
		const canvas = await ctx.tool("get_canvas", {
			target: { kind: "route", id: route.id },
			compact: true,
		});
		const noted = canvas.blocks.filter((b: any) => b.note).map((b: any) => b.key);
		return noted.length
			? { pass: true, message: noted.join(", ") }
			: { pass: false, message: "no block has a note" };
	},
};

/** A small window forces the conversation to be compacted partway through the build. */
const COMPACTED: Check = {
	name: "the conversation was compacted mid-build",
	run: async (ctx) =>
		ctx.summaries
			? { pass: true, message: `${ctx.summaries} summary` }
			: { pass: false, message: "no summary: raise the task's limit pressure" },
};

/** Some test suite of POST /signup asserts both exact error messages, not just a failing body. */
const suiteAssertsMessages: Check = {
	name: "a suite asserts the exact error messages",
	run: async (ctx) => {
		const [route] = (await ctx.tool("list_routes", { projectId: ctx.projectId })).items.filter(
			(r: any) => r.path === "/signup",
		);
		const suites = await ctx.tool("list_test_suites", { targetType: "route", targetId: route.id });
		const text = JSON.stringify(
			await Promise.all(suites.map((s: any) => ctx.tool("get_test_suite", { testSuiteId: s.id }))),
		);
		const missing = ["Email is required", "Email already registered"].filter(
			(m) => !text.includes(m),
		);
		return missing.length
			? { pass: false, message: `no assertion on: ${missing.join(", ")}` }
			: { pass: true, message: "both messages asserted" };
	},
};

export const moreTasks: Task[] = [
	{
		id: "suite-after-compaction",
		title: "Exact error messages in a suite, after the context was compacted (#704)",
		limits: { maxContextTokens: 20_000 },
		prompt:
			'Build POST /signup. The body is { "email": string }. A missing email answers 400 { "success": false, "message": "Email is required" }. The email "taken@x.io" answers 409 { "success": false, "message": "Email already registered" }. Any other email answers 201 { "success": true }. Then write a test suite for the 400 and the 409 case that asserts the exact message of each, and run it.',
		checks: [
			COMPACTED,
			expectCall(
				"missing email",
				"POST",
				"/signup",
				{ body: {} },
				{ status: 400, body: { success: false, message: "Email is required" } },
			),
			expectCall(
				"taken email",
				"POST",
				"/signup",
				{ body: { email: "taken@x.io" } },
				{ status: 409, body: { success: false, message: "Email already registered" } },
			),
			expectCall(
				"new email",
				"POST",
				"/signup",
				{ body: { email: "new@x.io" } },
				{ status: 201, body: { success: true } },
			),
			suiteAssertsMessages,
			suitesPass("POST", "/signup"),
		],
		judge: [
			"Asserted the exact message of each error, not just success: false",
			"Read the canvas again for block keys after the context was compacted, instead of trusting the summary",
			"Ran the suite and reported the real result",
		],
	},
	{
		id: "one-line-script-fix",
		title: "Change one line of a longer script (#704)",
		setup: async (ctx) => {
			await routeWithCode(ctx, { method: "GET", path: "/total", active: true }, ORDER_TOTAL);
		},
		prompt:
			'GET /total?subtotal=100 answers { "total": 120 }, but the tax rate is 10%, so it should be 110. Fix it.',
		checks: [
			expectCall(
				"tax is 10%",
				"GET",
				"/total",
				{ query: { subtotal: "100" } },
				{ status: 200, body: { total: 110 } },
			),
			usedEditCode,
		],
		judge: [
			"Changed only the tax line instead of rewriting the whole script",
			"Called the route again to confirm the fix",
		],
	},
	{
		id: "note-on-workaround",
		title: "Explain a workaround with a note (#704)",
		prompt:
			'Build GET /stamp that answers { "id": <the id query param>, "at": <the current time in ms> }. The time comes from a JS Runner block, whose output replaces the input, so carry the id past it in a saved variable (saveAsVariable "id").',
		checks: [
			expectCall(
				"stamps",
				"GET",
				"/stamp",
				{ query: { id: "7" } },
				{
					status: 200,
					body: (b: any) => b?.id === "7" && typeof b?.at === "number",
				},
			),
			wroteNote,
		],
		judge: [
			"Wrote a short note (blockDescription or a sticky note) saying why the variable exists, not just what the block does",
			"Called the route to confirm it answers the id and a time",
		],
	},
	{
		id: "forgotten-edge",
		title: "A block that is not connected to the response (#704)",
		setup: unwiredRoute,
		prompt: 'GET /ping should answer { "ok": true } but returns the default response. Fix it.',
		checks: [expectCall("pings", "GET", "/ping", {}, { status: 200, body: { ok: true } })],
		judge: [
			"Used the reachability warning or get_canvas to find the missing connection instead of rewriting the block",
			"Connected the existing block to the response rather than adding a second one",
			"Called the route again to confirm the fix",
		],
	},
	{
		id: "greeting-expression",
		title: "Dynamic value from the query",
		prompt:
			'Build GET /hello that answers { "message": "Hello <name>" }, using the `name` query param.',
		checks: [
			routeActive("GET", "/hello"),
			expectCall(
				"greets Ada",
				"GET",
				"/hello",
				{ query: { name: "Ada" } },
				{ status: 200, body: { message: "Hello Ada" } },
			),
			expectCall(
				"greets Grace",
				"GET",
				"/hello",
				{ query: { name: "Grace" } },
				{ status: 200, body: { message: "Hello Grace" } },
			),
		],
		judge: [
			"Made the name dynamic with a `js:` value or code, not a `{{ }}` template or text like `input.name` in a plain field",
			"Called the route with more than one name, or saw the result change with the name",
			"Ended with a short, accurate summary of what changed",
		],
	},
	{
		id: "broken-sql",
		title: "Fix a route with a broken SQL query",
		needsEnv: ["EVAL_POSTGRES_URL"],
		setup: brokenSqlRoute,
		prompt:
			'GET /table-exists answers 500. Fix it so it answers { "exists": true } for ?name=pg_class and { "exists": false } for ?name=no_such_table.',
		checks: [
			expectCall(
				"pg_class exists",
				"GET",
				"/table-exists",
				{ query: { name: "pg_class" } },
				{ status: 200, body: { exists: true } },
			),
			expectCall(
				"a missing table does not",
				"GET",
				"/table-exists",
				{ query: { name: "no_such_table" } },
				{ status: 200, body: { exists: false } },
			),
		],
		judge: [
			"Found the cause (the misspelled column relnmae) from the error call_route returned, not by guessing",
			"Fixed the query in the existing block instead of rebuilding the route",
			"Called the route again to confirm the fix",
		],
	},
];

import { type Ctx, expectCall, routeActive, type Task } from "./checks";

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

export const moreTasks: Task[] = [
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

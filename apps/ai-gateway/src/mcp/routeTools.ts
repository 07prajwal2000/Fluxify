import { renderCompactSchema } from "@fluxify/blocks";
import { getDefaultVariantValue, getSchema } from "@fluxify/server/src/api/v1/integrations/helpers";
import { integrationsGroupSchema } from "@fluxify/server/src/api/v1/integrations/schemas";
import { requestBodySchema as routeCreate } from "@fluxify/server/src/api/v1/routes/create/dto";
import { requestBodySchema as routePatch } from "@fluxify/server/src/api/v1/routes/update-partial/dto";
import {
	createSchema as workflowCreate,
	patchSchema as workflowPatch,
} from "@fluxify/server/src/api/v1/workflows/dto";
import { ValidationSchemaZod } from "@fluxify/server/src/lib/validationSchemaZod";
import { z } from "zod";
import type { AdminApi } from "./adminApi";
import type { McpTool } from "./tools";
import { optionalFields } from "./writeTools";

const SAVE = { readOnlyHint: false, destructiveHint: false };
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };
/** A call runs the user's graph for real: it can write, send and call out. */
const RUN = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

/** The recipe tool descriptions point to for a failing route or workflow. */
export const DEBUG_RECIPE = "agents/recipes/debug-and-fix";

/** A route's answer can be any size; this much is plenty to read. */
export const MAX_RESPONSE_CHARS = 10_000;

const idArg = (what: string) =>
	z.string().optional().describe(`${what} id to update; omit to create`);

/** The server's own request-schema shape, so a wrong one fails here with field errors. */
const requestSchema = (what: string) =>
	ValidationSchemaZod.nullable()
		.optional()
		.describe(`Validates the request ${what}. null removes it.`);

const ids = z.array(z.string()).optional();
const middlewaresArg = z
	.object({ before: ids, after: ids })
	.optional()
	.describe(
		"Middleware ids from list_middlewares, in run order. before runs before the canvas, after runs after it. A side you leave out stays as it is; [] clears it.",
	);

/** Sets a route's middlewares; the server replaces both sides, so a missing side keeps its current ids. */
async function setMiddlewares(
	api: AdminApi,
	routeId: string,
	m: { before?: string[]; after?: string[] },
) {
	let { before, after } = m;
	if (!before || !after) {
		const now = await api.get(`/v1/routes/${routeId}/middlewares`);
		const idsOf = (list: { id: string }[]) => list.map((x) => x.id);
		before ??= idsOf(now.before);
		after ??= idsOf(now.after);
	}
	await api.send("PUT", `/v1/routes/${routeId}/middlewares`, { before, after });
}

const SCHEMA_HINT =
	'bodySchema, querySchema and paramsSchema validate the request. They are Fluxify schemas, not JSON Schema: { dataType: "object", properties: [{ key: "id", dataType: "int", required: true }] }. dataType is str, int, float, bool, object, arr, enum, file or blob; arr takes items, object takes properties. A path with :params needs a paramsSchema naming each one.';

/** Cuts a big body so it fits an agent's context, and says it did. */
export function truncate(body: unknown) {
	const text = typeof body === "string" ? body : JSON.stringify(body);
	if (text === undefined || text.length <= MAX_RESPONSE_CHARS) return body;
	return `${text.slice(0, MAX_RESPONSE_CHARS)}… (truncated, ${text.length} characters in all)`;
}

/** block id → canvas key, so the agent reads keys everywhere, like in get_canvas */
export async function blockKeys(get: AdminApi["get"], kind: "route" | "workflow", id: string) {
	const canvas = await get(`/v1/${kind}s/${id}/canvas-items`).catch(() => undefined);
	return new Map<string, string>(
		(canvas?.blocks ?? []).flatMap((b: { id: string; key?: string }) =>
			b.key ? [[b.id, b.key]] : [],
		),
	);
}

/** The failed block is named by its canvas key. */
function withBlockKey(
	keys: Map<string, string>,
	error: { block?: { id: string; type: string; name?: string } },
) {
	if (!error.block) return error;
	const { id, ...rest } = error.block;
	const key = keys.get(id);
	// the uuid only for a block deleted since
	return { ...error, block: key ? { key, ...rest } : { id, ...rest } };
}

type DebugTrace = {
	spans: {
		blockId: string;
		blockType: string;
		outcome: string;
		ms: number;
		output?: string;
		error?: string;
	}[];
	more?: number;
};

/** One line per block that ran; the server already cut the outputs and capped the list. */
export function traceLines(keys: Map<string, string>, trace: DebugTrace) {
	const lines = trace.spans.map((s) => {
		const out = s.outcome === "success" ? "ok" : "ERROR";
		return `${keys.get(s.blockId) ?? s.blockId} (${s.blockType}) ${out} ${s.ms}ms${s.output ? ` → ${s.output}` : ""}${s.error ? `: ${s.error}` : ""}`;
	});
	return trace.more ? [...lines, `… ${trace.more} more blocks, see get_recording`] : lines;
}

export const routeTools: McpTool[] = [
	{
		name: "save_route",
		title: "Save route",
		description: `Create or update an HTTP route's settings. To create pass projectId, name, path ('/users/:id') and method. A new route starts INACTIVE: pass active: true, or call_route and real callers get 404. It starts with a canvas that answers 200. On update pass routeId and only what changes. ${SCHEMA_HINT} middlewares attaches middlewares (ids from list_middlewares): before runs before the canvas, after runs after it, each list in run order. Build the route's logic with get_canvas and edit_canvas.`,
		role: "creator",
		annotations: SAVE,
		input: {
			routeId: idArg("Route"),
			...optionalFields(routeCreate.shape),
			...optionalFields(routePatch.shape),
			bodySchema: requestSchema("body"),
			querySchema: requestSchema("query string"),
			paramsSchema: requestSchema("path params"),
			middlewares: middlewaresArg,
		},
		call: async (api, { routeId, projectId: p, middlewares, ...a }) => {
			const id: string =
				routeId ?? (await api.send("POST", "/v1/routes", { projectId: p, ...a })).id;
			// a middlewares-only update has nothing to patch
			if (routeId && (!middlewares || Object.keys(a).length)) {
				await api.send("PATCH", `/v1/routes/partial/${routeId}`, a);
			}
			if (middlewares) await setMiddlewares(api, id, middlewares);
			return { id };
		},
	},
	{
		name: "delete_route",
		title: "Delete route",
		description: "Delete a route and its canvas. Calls to its path start returning 404.",
		role: "creator",
		annotations: DELETE,
		input: { routeId: z.string().describe("Route id, from list_routes") },
		call: async ({ send }, a) => {
			await send("DELETE", `/v1/routes/${a.routeId}`);
			return { deleted: a.routeId };
		},
	},
	{
		name: "save_workflow",
		title: "Save workflow",
		description:
			"Create or update a workflow's settings (a background job started by triggers). To create pass projectId and name. On update pass workflowId and only what changes. Build its logic with get_canvas and edit_canvas.",
		role: "creator",
		annotations: SAVE,
		input: {
			workflowId: idArg("Workflow"),
			...optionalFields(workflowCreate.shape),
			...optionalFields(workflowPatch.shape),
		},
		call: async ({ send }, { workflowId, projectId: p, ...a }) => {
			const { id } = workflowId
				? await send("PATCH", `/v1/workflows/${workflowId}`, a)
				: await send("POST", "/v1/workflows", { projectId: p, ...a });
			return { id };
		},
	},
	{
		name: "delete_workflow",
		title: "Delete workflow",
		description: "Delete a workflow and its canvas. Triggers that started it start nothing.",
		role: "creator",
		annotations: DELETE,
		input: { workflowId: z.string().describe("Workflow id, from list_workflows") },
		call: async ({ send }, a) => {
			await send("DELETE", `/v1/workflows/${a.workflowId}`);
			return { deleted: a.workflowId };
		},
	},
	{
		name: "call_route",
		title: "Call route",
		description: `Send a REAL HTTP request to a route and get back its status and body. This runs the route for real: it can create, change or delete data and call other services. Read get_route first for the path params and the body/query schemas. The route must be active. Bodies over ${MAX_RESPONSE_CHARS} characters are cut. When the route fails, error has the real cause its callers never see: { block: { key, type, name }, message, detail (e.g. the SQL error), stack (your own code only) }. trace lists the blocks that ran, one line each (key, type, ok or ERROR, ms, output cut short); a long run ends with "… N more blocks, see get_recording". A route with tracing off has no trace. debug: false leaves out error and trace. To debug and fix: read_doc ${DEBUG_RECIPE}.`,
		role: "creator",
		annotations: RUN,
		input: {
			routeId: z.string().describe("Route id, from list_routes"),
			params: z
				.record(z.string(), z.string())
				.optional()
				.describe("Path params, e.g. { id: '42' } for /users/:id"),
			query: z.record(z.string(), z.string()).optional(),
			headers: z.record(z.string(), z.string()).optional(),
			body: z.unknown().optional().describe("JSON body; a string is sent as-is"),
			debug: z
				.boolean()
				.optional()
				.describe("On by default: also return the real error and a trace of the blocks that ran"),
		},
		call: async ({ get, send }, { routeId, debug = true, ...a }) => {
			const { debugError, debugTrace, ...result } = await send(
				"POST",
				`/v1/routes/${routeId}/call`,
				{ ...a, debug },
			);
			const keys = debugError || debugTrace ? await blockKeys(get, "route", routeId) : new Map();
			return {
				...result,
				body: truncate(result.body),
				...(debugError && { error: withBlockKey(keys, debugError) }),
				...(debugTrace && { trace: traceLines(keys, debugTrace) }),
			};
		},
	},
	{
		name: "get_integration_schema",
		title: "Get integration schema",
		description:
			"The config fields one integration variant needs, with types, which are required (no '?') and blank defaults. Call it before save_integration or test_integration_connection.",
		role: "viewer",
		input: {
			group: integrationsGroupSchema,
			variant: z.string().describe("e.g. 'PostgreSQL', 'Redis', 'OpenAI'"),
		},
		// built from the server's own validation schemas; reads no project data
		call: async (_api, a) => integrationSchema(a.group, a.variant),
	},
];

export function integrationSchema(group: z.infer<typeof integrationsGroupSchema>, variant: string) {
	const schema = getSchema(group, variant);
	if (!schema) return `Unknown variant "${variant}" for group "${group}".`;
	const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
	return {
		config: renderCompactSchema(json as Record<string, unknown>),
		defaults: getDefaultVariantValue(variant as Parameters<typeof getDefaultVariantValue>[0]),
	};
}

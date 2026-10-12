import { blockAiDescriptions, COMPACT_SHARED_TYPES, renderCompactSchema } from "@fluxify/blocks";
import { getOutputHandles } from "@fluxify/blocks/blockHandles";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AdminApi, ToolRole } from "./adminApi";
import { suiteWithKeys } from "./suiteHooks";

/**
 * One MCP tool backed by the admin API. `call` goes through `api`, which acts
 * as the caller; the server decides what they may see or change. `role` only words the
 * 403 message — it is never checked here.
 */
export type McpTool = {
	name: string;
	/** Human name for UIs and MCP clients, e.g. "Save route". */
	title: string;
	description: string;
	role: ToolRole;
	input: z.ZodRawShape;
	/** Read-only unless set */
	annotations?: ToolAnnotations;
	call: (api: AdminApi, args: any) => Promise<unknown>;
};

const PER_PAGE = 50;

/** A string that fails `s` gets one more try as JSON: models send `"true"`, `"5"` or `"[...]"` for typed params. */
const lenientField = (s: z.ZodType) => {
	const w = z.preprocess((v) => {
		if (typeof v !== "string" || s.safeParse(v).success) return v;
		try {
			return JSON.parse(v);
		} catch {
			return v;
		}
	}, s);
	// ponytail: zod internals; keeps required/optional in the JSON schema (preprocess marks every field optional)
	Object.assign(w._zod, { optin: s._zod.optin, optout: s._zod.optout });
	return w;
};

/** Every tool's input goes through this, for MCP clients and the agent alike. */
export const lenient = (shape: z.ZodRawShape): z.ZodRawShape =>
	Object.fromEntries(Object.entries(shape).map(([k, s]) => [k, lenientField(s as z.ZodType)]));

export const pick = <T extends Record<string, unknown>>(row: T, keys: (keyof T)[]) =>
	Object.fromEntries(keys.map((k) => [k, row[k]]));

export const projectId = z.string().describe("Project id, from list_projects");
/**
 * The environment a read looks at (#737). Development unless production is
 * asked for, and production only when the user asked: it asks first.
 */
export const envInput = (what = "") =>
	z
		.enum(["development", "production"])
		.optional()
		.describe(
			`development by default. Only use production when the user explicitly asks for it${what ? `. ${what}` : ""}`,
		);
export const page = z.number().int().min(1).optional().describe("Page number, 1 by default");
const search = z.string().optional().describe("Only items whose name contains this");

/** A paged admin list, trimmed to `keys` per row. */
const paged = (body: any, keys: string[]) => ({
	items: body.data.map((row: any) => pick(row, keys)),
	page: body.pagination.page,
	hasNext: body.pagination.hasNext,
});

const escapeTableCell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");

const BUILTIN_BLOCKS_TABLE = `| Type | Name | Description |
| --- | --- | --- |
${blockAiDescriptions
	.map(({ name, description }) => `| ${name} | ${name} | ${escapeTableCell(description)} |`)
	.join("\n")}`;

/** Built-in blocks never come from a project, so this reads no API. */
function blockSchemas(blockTypes?: string[]) {
	if (!blockTypes?.length)
		return `${BUILTIN_BLOCKS_TABLE}

Call again with blockTypes for each block's fields, handles, output and an example.`;
	const contracts = blockTypes.map((type) => {
		const block = blockAiDescriptions.find((b) => b.name === type);
		if (!block)
			return `${type}: unknown block type. Call get_block_schemas with no input for the list.`;
		const schema = block.jsonSchema
			? renderCompactSchema(block.jsonSchema)
			: "{} // no configuration";
		// #673: what valid data looks like, and what the next block gets as `input`
		const handles = getOutputHandles(type);
		return `${type} ${schema}
Handles (connect from): ${handles.join(", ") || "none, it ends the flow"}
Output (the next block's input): ${block.output}
Example data: ${JSON.stringify(block.example)}`;
	});
	const body = contracts.join("\n\n");
	// the three shared condition types are named, not inlined, in the contracts
	const usesShared = /\b(DbConditionSide|DbWhereCondition|Condition)\b/.test(body);
	return usesShared ? `${COMPACT_SHARED_TYPES}\n\n${body}` : body;
}

/** A test suite body can carry 1MB of base64 files; only small ones are worth reading. */
const MAX_BODY_CHARS = 2000;

export const readTools: McpTool[] = [
	{
		name: "get_instance_info",
		title: "Get instance info",
		description:
			"Fluxify edition, licence status, whether orchestration is on, and the Bun version.",
		role: "viewer",
		input: {},
		call: async ({ get }) => {
			const s = await get("/public-settings");
			return {
				edition: s.license.status === "community" ? "community" : "enterprise",
				licence: pick(s.license, ["status", "features", "daysRemaining"]),
				orchestration: s.orchestration.enabled,
				bunVersion: s.bunVersion,
			};
		},
	},
	{
		name: "list_projects",
		title: "List projects",
		description: "Projects you are a member of. Start here: most tools need a projectId.",
		role: "viewer",
		input: { page },
		call: async ({ get }, a) =>
			paged(await get("/v1/projects/list", { page: a.page, perPage: PER_PAGE }), [
				"id",
				"name",
				"description",
			]),
	},
	{
		name: "get_project",
		title: "Get project",
		description: "One project's name, slug and description.",
		role: "viewer",
		input: { projectId },
		call: async ({ get }, a) =>
			pick(await get(`/v1/projects/${a.projectId}`), ["id", "name", "slug", "description"]),
	},
	{
		name: "get_system_logs",
		title: "Get system logs",
		description:
			"Platform logs for a project, newest first: compile results, orchestrator status and runtime errors of recorded runs (type runtime, with the failing block, stack and runId).",
		role: "viewer",
		input: {
			projectId,
			level: z.enum(["info", "warn", "error"]).optional().describe("Only this level"),
			type: z.string().optional().describe("Only this kind, e.g. compile or runtime"),
			resourceId: z
				.string()
				.optional()
				.describe("Only logs about this route, workflow, trigger or sandbox id"),
			env: envInput(
				"Runtime errors from this environment's workers; compile and orchestrator logs show for both",
			),
			limit: z.number().int().min(1).max(200).optional().describe("How many, 50 by default"),
		},
		call: async ({ get }, a) => {
			const body = await get(`/v1/projects/${a.projectId}/system-logs`, {
				env: a.env ?? "development",
				level: a.level,
				type: a.type,
				resourceId: a.resourceId,
				limit: a.limit,
			});
			return body.items.map((log: any) =>
				pick(log, [
					"resourceType",
					"resourceId",
					"level",
					"type",
					"message",
					"detail",
					"updatedAt",
				]),
			);
		},
	},
	{
		name: "list_routes",
		title: "List routes",
		description:
			"A project's HTTP routes: method, path and whether each is on in production (active) and in development (devActive).",
		role: "viewer",
		input: { projectId, page, search },
		call: async ({ get }, a) =>
			paged(
				await get("/v1/routes/list", {
					projectId: a.projectId,
					page: a.page,
					perPage: PER_PAGE,
					...(a.search && {
						"filter.field": "name",
						"filter.operator": "like",
						"filter.value": a.search,
					}),
				}),
				["id", "name", "method", "path", "active", "devActive"],
			),
	},
	{
		name: "get_route",
		title: "Get route",
		description:
			"One route's settings, its body, query and params schemas (what call_route must send) and its before/after middlewares in run order. headVersionNumber is the version its working copy came from and uncommitted says it holds changes no version does (list_versions, commit_version). prodVersionNumber is the version production serves, null until one is promoted: a route serves nothing in production without one, even with active on. Its canvas (blocks and edges) is not included.",
		role: "viewer",
		input: { routeId: z.string().describe("Route id, from list_routes") },
		call: async ({ get }, a) => {
			const [route, m] = await Promise.all([
				get(`/v1/routes/${a.routeId}`),
				get(`/v1/routes/${a.routeId}/middlewares`),
			]);
			const named = (list: { id: string; name: string }[]) =>
				list.map(({ id, name }) => ({ id, name }));
			return {
				...pick(route, [
					"id",
					"name",
					"method",
					"path",
					"active",
					"devActive",
					"timeoutSeconds",
					"tracingEnabled",
					"recordExecution",
					"devTracingEnabled",
					"devRecordExecution",
					"acceptedContentTypes",
					"bodySchema",
					"querySchema",
					"paramsSchema",
					"headVersionNumber",
					"prodVersionNumber",
					"uncommitted",
				]),
				middlewares: { before: named(m.before), after: named(m.after) },
			};
		},
	},
	{
		name: "list_workflows",
		title: "List workflows",
		description: "A project's workflows: background jobs that triggers start.",
		role: "viewer",
		input: { projectId, page, search },
		call: async ({ get }, a) =>
			paged(
				await get("/v1/workflows/list", {
					projectId: a.projectId,
					page: a.page,
					perPage: PER_PAGE,
					search: a.search,
				}),
				["id", "name", "description", "active", "devActive"],
			),
	},
	{
		name: "get_workflow",
		title: "Get workflow",
		description:
			"One workflow's settings, the version its working copy came from (headVersionNumber), the version production serves (prodVersionNumber, null until one is promoted) and whether it has uncommitted changes. Its canvas is not included.",
		role: "viewer",
		input: { workflowId: z.string().describe("Workflow id, from list_workflows") },
		call: async ({ get }, a) =>
			pick(await get(`/v1/workflows/${a.workflowId}`), [
				"id",
				"name",
				"description",
				"active",
				"devActive",
				"timeoutSeconds",
				"tracingEnabled",
				"recordExecution",
				"devTracingEnabled",
				"devRecordExecution",
				"headVersionNumber",
				"prodVersionNumber",
				"uncommitted",
			]),
	},
	{
		name: "list_triggers",
		title: "List triggers",
		description: "A project's triggers (schedules, queues, …) and the workflow each one starts.",
		role: "viewer",
		input: {
			projectId,
			workflowId: z.string().optional().describe("Only triggers that start this workflow"),
			sandboxId: z.string().optional().describe("Only triggers that run this sandbox of yours"),
			page,
			search,
		},
		call: async ({ get }, a) =>
			paged(
				await get("/v1/triggers/list", {
					projectId: a.projectId,
					workflowId: a.workflowId,
					sandboxId: a.sandboxId,
					page: a.page,
					perPage: PER_PAGE,
					search: a.search,
				}),
				["id", "name", "type", "active", "workflow", "sandboxId", "disabledReason"],
			),
	},
	{
		name: "get_trigger",
		title: "Get trigger",
		description: "One trigger's full settings: schedule or source, batching, retries.",
		role: "viewer",
		input: { triggerId: z.string().describe("Trigger id, from list_triggers") },
		call: async ({ get }, a) => {
			const {
				projectId: _p,
				createdAt: _c,
				updatedAt: _u,
				...rest
			} = await get(`/v1/triggers/${a.triggerId}`);
			return rest;
		},
	},
	{
		name: "list_custom_blocks",
		title: "List custom blocks",
		description:
			"A project's custom blocks: reusable code blocks, middleware links and test hooks.",
		role: "viewer",
		input: { projectId },
		call: async ({ get }, a) =>
			(await get("/v1/custom-blocks/list", { projectId: a.projectId })).map((b: any) =>
				pick(b, ["id", "name", "label", "description", "usage"]),
			),
	},
	{
		name: "get_custom_block",
		title: "Get custom block",
		description:
			"One custom block's inputs and docs, which version is live in production (prodVersionNumber), whether the working copy has uncommitted changes, and everything that uses it (references). Its code is not included.",
		role: "viewer",
		input: { customBlockId: z.string().describe("Custom block id, from list_custom_blocks") },
		call: async ({ get }, a) => {
			const [block, used] = await Promise.all([
				get(`/v1/custom-blocks/${a.customBlockId}`),
				get(`/v1/custom-blocks/${a.customBlockId}/references`),
			]);
			return {
				...pick(block, [
					"id",
					"name",
					"label",
					"description",
					"usage",
					"inputParams",
					"docs",
					"headVersionNumber",
					"prodVersionNumber",
					"uncommitted",
				]),
				references: used.references,
			};
		},
	},
	{
		name: "list_middlewares",
		title: "List middlewares",
		description:
			"A project's middlewares: named chains of custom blocks run before or after routes.",
		role: "viewer",
		input: { projectId },
		call: async ({ get }, a) =>
			(await get("/v1/middlewares/list", { projectId: a.projectId })).map((m: any) => ({
				...pick(m, ["id", "name", "description", "routeCount"]),
				blocks: m.blocks.map((b: any) => b.name),
			})),
	},
	{
		name: "get_middleware",
		title: "Get middleware",
		description:
			"One middleware and its custom blocks in run order, which version is live in production (prodVersionNumber), whether the chain has uncommitted changes, and the routes that use it (references).",
		role: "viewer",
		input: { middlewareId: z.string().describe("Middleware id, from list_middlewares") },
		call: async ({ get }, a) => {
			const [m, used] = await Promise.all([
				get(`/v1/middlewares/${a.middlewareId}`),
				get(`/v1/middlewares/${a.middlewareId}/references`),
			]);
			return {
				...pick(m, [
					"id",
					"name",
					"description",
					"headVersionNumber",
					"prodVersionNumber",
					"uncommitted",
				]),
				blocks: m.blocks.map((b: any) => pick(b, ["id", "name", "label"])),
				references: used.references,
			};
		},
	},
	{
		name: "list_test_suites",
		title: "List test suites",
		description:
			"Test suites. Pass projectId for every suite in a project (with its target's name), or targetType + targetId for the suites of one route or workflow.",
		role: "viewer",
		input: {
			projectId: z.string().optional().describe("List every suite in this project"),
			targetType: z.enum(["route", "workflow"]).optional().describe("What the suites test"),
			targetId: z.string().optional().describe("The route or workflow id"),
		},
		call: async ({ get }, a) => {
			if (a.targetType && a.targetId) {
				return (await get(`/v1/test-suites/${a.targetType}/${a.targetId}`)).map((s: any) =>
					pick(s, ["id", "name", "description"]),
				);
			}
			if (!a.projectId) throw new Error("Pass projectId, or targetType and targetId.");
			return await get(`/v1/test-suites/project/${a.projectId}`);
		},
	},
	{
		name: "get_test_suite",
		title: "Get test suite",
		description: "One test suite: its request or input, assertions and hooks.",
		role: "viewer",
		input: { testSuiteId: z.string().describe("Test suite id, from list_test_suites") },
		call: async ({ get }, a) => {
			const {
				createdAt: _c,
				updatedAt: _u,
				body,
				...rest
			} = await suiteWithKeys(get, await get(`/v1/test-suites/${a.testSuiteId}`));
			const size = JSON.stringify(body ?? null).length;
			return { ...rest, body: size > MAX_BODY_CHARS ? `(omitted: ${size} characters)` : body };
		},
	},
	{
		name: "list_app_config",
		title: "List app config",
		description:
			"A project's app config keys (settings and secrets blocks read). Values are not listed; hasDevValue says whether development has its own, syncDev that it reads the production value instead.",
		role: "creator",
		input: { projectId, page, search },
		call: async ({ get }, a) =>
			paged(
				await get(`/v1/${a.projectId}/app-config/list`, {
					page: a.page,
					perPage: PER_PAGE,
					search: a.search,
				}),
				["id", "keyName", "dataType", "isEncrypted", "hasDevValue", "syncDev"],
			),
	},
	{
		name: "get_app_config",
		title: "Get app config",
		description:
			"One app config entry. By default only the development value (devValue, null while it has none; syncDev true means development reads the production value, so it shows that). env production also returns the production value. Encrypted values come back masked.",
		role: "creator",
		input: {
			projectId,
			appConfigId: z.number().int().describe("App config id, from list_app_config"),
			env: envInput("production adds its value (the ask comes first)"),
		},
		call: async ({ get }, a) => {
			const row = pick(await get(`/v1/${a.projectId}/app-config/${a.appConfigId}`), [
				"id",
				"keyName",
				"description",
				"value",
				"devValue",
				"syncDev",
				"dataType",
				"isEncrypted",
				"encodingType",
			]);
			if (a.env === "production") return row;
			// development: its own value, or production's when it reads that
			const { value, ...dev } = row;
			return { ...dev, devValue: row.syncDev ? value : row.devValue };
		},
	},
	{
		name: "list_integrations",
		title: "List integrations",
		description:
			"A project's integrations: databases, KV stores, AI providers and queues. hasDevConfig says whether development has its own config, syncDev that it reads the production one instead.",
		role: "creator",
		input: { projectId },
		call: async ({ get }, a) => get(`/v1/${a.projectId}/integrations/list-basic`),
	},
	{
		name: "get_integration",
		title: "Get integration",
		description:
			"One integration's settings. By default only the development config (devConfig, null while it has none; syncDev true means development uses the production config, so it shows that). env production also returns config, production's own.",
		role: "creator",
		input: {
			projectId,
			integrationId: z.string().describe("Integration id, from list_integrations"),
			env: envInput("production adds config (the ask comes first)"),
		},
		call: async ({ get }, a) => {
			const row = await get(`/v1/${a.projectId}/integrations/${a.integrationId}`);
			if (a.env === "production") return row;
			// development: its own config, or production's when it uses that
			const { config, ...dev } = row;
			return { ...dev, devConfig: row.syncDev ? config : row.devConfig };
		},
	},
	{
		name: "list_members",
		title: "List members",
		description: "A project's members and their roles.",
		role: "creator",
		input: { projectId, page },
		call: async ({ get }, a) =>
			paged(
				await get(`/v1/projects/${a.projectId}/settings/members/list`, {
					page: a.page,
					perPage: PER_PAGE,
				}),
				["userId", "name", "role"],
			),
	},
	{
		name: "get_block_schemas",
		title: "Get block schemas",
		description:
			"Built-in blocks for canvases. No input: the list of block types. With blockTypes: their exact data contracts, output handles, an example of valid data, and what each outputs (the next block's `input`). For a custom block's inputs use get_custom_block. Block text inputs are literal unless they start with `js:` followed by code that returns the value (e.g. `js: return input.id`); never use `{{ }}`.",
		role: "viewer",
		input: {
			blockTypes: z
				.array(z.string())
				.max(10)
				.optional()
				.describe("Block types, e.g. ['db_getall', 'if']"),
		},
		call: async (_api, a) => blockSchemas(a.blockTypes),
	},
];

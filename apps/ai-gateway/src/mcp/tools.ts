import { blockAiDescriptions, COMPACT_SHARED_TYPES, renderCompactSchema } from "@fluxify/blocks";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BUILTIN_BLOCKS_TABLE } from "../harness/agents/sub-agents/blockBuilder/promptHelpers";
import type { AdminApi, ToolRole } from "./adminApi";

/**
 * One MCP tool backed by the admin API. `call` goes through `api`, which acts
 * as the caller; the server decides what they may see or change. `role` only words the
 * 403 message — it is never checked here.
 */
export type McpTool = {
	name: string;
	description: string;
	role: ToolRole;
	input: z.ZodRawShape;
	/** Read-only unless set */
	annotations?: ToolAnnotations;
	call: (api: AdminApi, args: any) => Promise<unknown>;
};

const PER_PAGE = 50;

export const pick = <T extends Record<string, unknown>>(row: T, keys: (keyof T)[]) =>
	Object.fromEntries(keys.map((k) => [k, row[k]]));

export const projectId = z.string().describe("Project id, from list_projects");
export const page = z.number().int().min(1).optional().describe("Page number, 1 by default");
const search = z.string().optional().describe("Only items whose name contains this");

/** A paged admin list, trimmed to `keys` per row. */
const paged = (body: any, keys: string[]) => ({
	items: body.data.map((row: any) => pick(row, keys)),
	page: body.pagination.page,
	hasNext: body.pagination.hasNext,
});

/** Built-in blocks never come from a project, so this reads no API. */
function blockSchemas(blockTypes?: string[]) {
	if (!blockTypes?.length) return BUILTIN_BLOCKS_TABLE;
	const contracts = blockTypes.map((type) => {
		const block = blockAiDescriptions.find((b) => b.name === type);
		if (!block)
			return `${type}: unknown block type. Call get_block_schemas with no input for the list.`;
		const schema = block.jsonSchema
			? renderCompactSchema(block.jsonSchema)
			: "{} // no configuration";
		// #673: what valid data looks like, and what the next block gets as `input`
		return `${type} ${schema}
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
		description: "One project's name, slug and description.",
		role: "viewer",
		input: { projectId },
		call: async ({ get }, a) =>
			pick(await get(`/v1/projects/${a.projectId}`), ["id", "name", "slug", "description"]),
	},
	{
		name: "get_system_logs",
		description:
			"Platform logs for a project, newest first: compile results and other errors per route, workflow or trigger.",
		role: "viewer",
		input: {
			projectId,
			level: z.enum(["info", "warn", "error"]).optional().describe("Only this level"),
			resourceId: z
				.string()
				.optional()
				.describe("Only logs about this route, workflow or trigger id"),
			limit: z.number().int().min(1).max(200).optional().describe("How many, 50 by default"),
		},
		call: async ({ get }, a) => {
			const body = await get(`/v1/projects/${a.projectId}/system-logs`, {
				level: a.level,
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
		description: "A project's HTTP routes: method, path and whether each is active.",
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
				["id", "name", "method", "path", "active"],
			),
	},
	{
		name: "get_route",
		description:
			"One route's settings, its body, query and params schemas (what call_route must send) and its before/after middlewares in run order. Its canvas (blocks and edges) is not included.",
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
					"timeoutSeconds",
					"tracingEnabled",
					"recordExecution",
					"acceptedContentTypes",
					"bodySchema",
					"querySchema",
					"paramsSchema",
				]),
				middlewares: { before: named(m.before), after: named(m.after) },
			};
		},
	},
	{
		name: "list_workflows",
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
				["id", "name", "description", "active"],
			),
	},
	{
		name: "get_workflow",
		description: "One workflow's settings. Its canvas is not included.",
		role: "viewer",
		input: { workflowId: z.string().describe("Workflow id, from list_workflows") },
		call: async ({ get }, a) =>
			pick(await get(`/v1/workflows/${a.workflowId}`), [
				"id",
				"name",
				"description",
				"active",
				"timeoutSeconds",
				"tracingEnabled",
				"recordExecution",
			]),
	},
	{
		name: "list_triggers",
		description: "A project's triggers (schedules, queues, …) and the workflow each one starts.",
		role: "viewer",
		input: {
			projectId,
			workflowId: z.string().optional().describe("Only triggers that start this workflow"),
			page,
			search,
		},
		call: async ({ get }, a) =>
			paged(
				await get("/v1/triggers/list", {
					projectId: a.projectId,
					workflowId: a.workflowId,
					page: a.page,
					perPage: PER_PAGE,
					search: a.search,
				}),
				["id", "name", "type", "active", "workflow", "disabledReason"],
			),
	},
	{
		name: "get_trigger",
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
		description: "One custom block's inputs and docs. Its code is not included.",
		role: "viewer",
		input: { customBlockId: z.string().describe("Custom block id, from list_custom_blocks") },
		call: async ({ get }, a) =>
			pick(await get(`/v1/custom-blocks/${a.customBlockId}`), [
				"id",
				"name",
				"label",
				"description",
				"usage",
				"inputParams",
				"docs",
			]),
	},
	{
		name: "list_middlewares",
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
		description: "One middleware and its custom blocks in run order.",
		role: "viewer",
		input: { middlewareId: z.string().describe("Middleware id, from list_middlewares") },
		call: async ({ get }, a) => {
			const m = await get(`/v1/middlewares/${a.middlewareId}`);
			return {
				...pick(m, ["id", "name", "description"]),
				blocks: m.blocks.map((b: any) => pick(b, ["id", "name", "label"])),
			};
		},
	},
	{
		name: "list_test_suites",
		description: "The test suites of one route or workflow.",
		role: "viewer",
		input: {
			targetType: z.enum(["route", "workflow"]).describe("What the suites test"),
			targetId: z.string().describe("The route or workflow id"),
		},
		call: async ({ get }, a) =>
			(await get(`/v1/test-suites/${a.targetType}/${a.targetId}`)).map((s: any) =>
				pick(s, ["id", "name", "description"]),
			),
	},
	{
		name: "get_test_suite",
		description: "One test suite: its request or input, assertions and hooks.",
		role: "viewer",
		input: { testSuiteId: z.string().describe("Test suite id, from list_test_suites") },
		call: async ({ get }, a) => {
			const {
				createdAt: _c,
				updatedAt: _u,
				body,
				...rest
			} = await get(`/v1/test-suites/${a.testSuiteId}`);
			const size = JSON.stringify(body ?? null).length;
			return { ...rest, body: size > MAX_BODY_CHARS ? `(omitted: ${size} characters)` : body };
		},
	},
	{
		name: "list_app_config",
		description:
			"A project's app config keys (settings and secrets blocks read). Values are not listed.",
		role: "creator",
		input: { projectId, page, search },
		call: async ({ get }, a) =>
			paged(
				await get(`/v1/${a.projectId}/app-config/list`, {
					page: a.page,
					perPage: PER_PAGE,
					search: a.search,
				}),
				["id", "keyName", "dataType", "isEncrypted"],
			),
	},
	{
		name: "get_app_config",
		description: "One app config entry with its value. Encrypted values come back masked.",
		role: "creator",
		input: {
			projectId,
			appConfigId: z.number().int().describe("App config id, from list_app_config"),
		},
		call: async ({ get }, a) =>
			pick(await get(`/v1/${a.projectId}/app-config/${a.appConfigId}`), [
				"id",
				"keyName",
				"description",
				"value",
				"dataType",
				"isEncrypted",
				"encodingType",
			]),
	},
	{
		name: "list_integrations",
		description: "A project's integrations: databases, KV stores, AI providers and queues.",
		role: "creator",
		input: { projectId },
		call: async ({ get }, a) => get(`/v1/${a.projectId}/integrations/list-basic`),
	},
	{
		name: "get_integration",
		description: "One integration's settings.",
		role: "creator",
		input: {
			projectId,
			integrationId: z.string().describe("Integration id, from list_integrations"),
		},
		call: async ({ get }, a) => get(`/v1/${a.projectId}/integrations/${a.integrationId}`),
	},
	{
		name: "list_members",
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
		description:
			"Built-in blocks for canvases. No input: the list of block types. With blockTypes: their exact data contracts, an example of valid data, and what each outputs (the next block's `input`). For a custom block's inputs use get_custom_block. Block text inputs are literal unless they start with `js:` followed by code that returns the value (e.g. `js: return input.id`); never use `{{ }}`.",
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

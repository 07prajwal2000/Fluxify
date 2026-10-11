import { type ModelMessage, type Tool, tool } from "ai";
import { z } from "zod";
import { type AdminFetch, adminApi } from "../mcp/adminApi";
import { canvasTools } from "../mcp/canvasTools";
import { docsTools } from "../mcp/docsTools";
import { projectTools } from "../mcp/projectTools";
import { routeTools } from "../mcp/routeTools";
import { sandboxTools } from "../mcp/sandboxTools";
import { testSuiteTools } from "../mcp/testSuiteTools";
import { envInput, lenient, type McpTool, readTools } from "../mcp/tools";
import { writeTools } from "../mcp/writeTools";

const ALL: McpTool[] = [
	...readTools,
	...writeTools,
	...routeTools,
	...sandboxTools,
	...canvasTools,
	...projectTools,
	...testSuiteTools,
	...docsTools,
];

const PROJECT_FIELD = z
	.string()
	.optional()
	.describe("This chat's project. Leave it out: it is filled in for you");

/** What `list` reads: each one only needs the project id. */
export const LIST_TYPES = {
	routes: "list_routes",
	workflows: "list_workflows",
	triggers: "list_triggers",
	custom_blocks: "list_custom_blocks",
	middlewares: "list_middlewares",
	integrations: "list_integrations",
	app_config: "list_app_config",
} as const;

/** What `get` reads, and the id argument each tool takes. */
export const GET_TYPES = {
	route: ["get_route", "routeId"],
	workflow: ["get_workflow", "workflowId"],
	trigger: ["get_trigger", "triggerId"],
	custom_block: ["get_custom_block", "customBlockId"],
	middleware: ["get_middleware", "middlewareId"],
	integration: ["get_integration", "integrationId"],
	app_config: ["get_app_config", "appConfigId"],
} as const;

/** Wrapped as-is and always on. `list` and `get` stand in for the list_* / get_* they cover. */
const CORE_MCP = [
	"save_route",
	"save_workflow",
	"save_custom_block",
	"save_trigger",
	"get_canvas",
	"edit_canvas",
	"get_block_schemas",
	"call_route",
	"save_test_suite",
	"get_test_suite",
	"run_test_suite",
	"get_system_logs",
	"get_recording",
	"list_test_suites",
	"get_test_runs",
	"search_docs",
	"read_doc",
];
const COVERED = new Set<string>([
	...Object.values(LIST_TYPES),
	...Object.values(GET_TYPES).map(([n]) => n),
]);
/** Everything else loads on demand through load_tools. */
export const ADVANCED = ALL.filter((t) => !CORE_MCP.includes(t.name) && !COVERED.has(t.name));

export const CORE = [...CORE_MCP, "list", "get", "list_advanced_tools", "load_tools"];

export type Mode = "manual" | "auto" | "plan";
export const MODES: Mode[] = ["manual", "auto", "plan"];

/** Reads never ask: the agent's own list/get/meta tools, and MCP tools marked read-only (unmarked = read, as in mcp/index.ts). */
export const isRead = (name: string) => {
	if (["list", "get", "list_advanced_tools", "load_tools"].includes(name)) return true;
	const t = ALL.find((x) => x.name === name);
	return !!t && t.annotations?.readOnlyHint !== false;
};

const AGENT_TITLES: Record<string, string> = {
	list: "List resources",
	get: "Get resource",
	list_advanced_tools: "List advanced tools",
	load_tools: "Load tools",
};

/** The human name of a tool, for chat rows and the approval bar. */
export const titleOf = (name: string) =>
	AGENT_TITLES[name] ??
	ALL.find((t) => t.name === name)?.title ??
	name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Deletes ask in every mode and are never approved for the whole session. */
export const isDelete = (name: string) => /^(delete|remove)_/.test(name);

/** The one tool a project can make ask in every mode, auto included (#741). */
export const EPHEMERAL_RUN_TOOL = "run_blocks";

/** The tool that moves blocks between canvases (#752). */
export const COPY_TOOL = "copy_blocks";

/**
 * copy_blocks into a route, workflow or custom block changes live work, so it
 * asks even in auto and is never approved for the whole session. Into a
 * sandbox (new or existing) it is a plain write. An unreadable target asks.
 */
export function copiesIntoRealCanvas(name: string, args: unknown) {
	if (name !== COPY_TOOL) return false;
	let to = (args as { to?: unknown } | undefined)?.to;
	if (typeof to === "string" && to !== "__new_sandbox__") {
		try {
			to = JSON.parse(to);
		} catch {}
	}
	return to !== "__new_sandbox__" && (to as { kind?: string } | undefined)?.kind !== "sandbox";
}

/** Tools that take an `env` and read production only when it is "production". */
const PROD_READ_TOOLS = [
	"list_recordings",
	"get_recording",
	"get_system_logs",
	"kv_get",
	"get_app_config",
	"get_integration",
];

/**
 * What a call does to production (#737), or undefined when it stays on
 * development. A read names `env: "production"` (`get` for app config and
 * integrations too). A write sets production's own value or config, or saves a
 * trigger: triggers are shared by both environments. Calls that only set
 * devValue / devConfig / syncDev are development. Canvas saves are not here:
 * they only change development until a version is promoted (#739).
 */
export function touchesProd(name: string, args: unknown): "read" | "write" | undefined {
	const a = (args ?? {}) as Record<string, unknown>;
	if (name === "save_trigger") return "write";
	if (name === "save_app_config") return a.value !== undefined ? "write" : undefined;
	if (name === "save_integration") return a.config !== undefined ? "write" : undefined;
	const reads =
		PROD_READ_TOOLS.includes(name) ||
		(name === "get" && (a.type === "app_config" || a.type === "integration"));
	return reads && a.env === "production" ? "read" : undefined;
}

/** The project's "Ask before production reads / writes" settings (#737). */
export type ProdAsks = { reads: boolean; writes: boolean };

/**
 * The one ask rule. Deletes always ask; reads never do. Other calls ask in
 * manual (and plan, where they are not active anyway) but not in auto, so
 * call_route and run_test_suite run unasked in auto despite destructiveHint.
 * `askBeforeEphemeral` is the project's "Ask before ephemeral runs" setting:
 * run_blocks then asks in auto too. `prod` is the two production settings: a
 * production read or write asks in auto too. `args` is only read for
 * copy_blocks and the production rule.
 */
export const needsApproval = (
	mode: Mode,
	name: string,
	askBeforeEphemeral = false,
	args?: unknown,
	prod: ProdAsks = { reads: true, writes: true },
) => {
	const touched = touchesProd(name, args);
	return (
		isDelete(name) ||
		(askBeforeEphemeral && name === EPHEMERAL_RUN_TOOL) ||
		copiesIntoRealCanvas(name, args) ||
		(touched === "read" && prod.reads) ||
		(touched === "write" && prod.writes) ||
		(!isRead(name) && mode !== "auto")
	);
};

/** Calls one MCP tool by name as the `auth` user, its input checked like the agent's. */
export const mcpCall =
	(fetcher: AdminFetch, auth: Record<string, string>) =>
	(name: string, args: unknown, signal?: AbortSignal): Promise<any> => {
		const t = ALL.find((x) => x.name === name);
		if (!t) throw new Error(`No tool named ${name}`);
		return t.call(adminApi(fetcher, auth, t.role, signal), z.object(lenient(t.input)).parse(args));
	};

/**
 * The agent's tools, all acting as the PAT's user through the admin API.
 * `active()` is what the next step may call: the core plus whatever load_tools added.
 * `loaded` must outlive one message: the history still says a tool was loaded,
 * so a fresh set per turn left the model calling a tool it could no longer reach (#672).
 */
export function agentTools(
	fetcher: AdminFetch,
	auth: Record<string, string>,
	projectId: string,
	loaded = new Set<string>(),
) {
	const run = mcpCall(fetcher, auth);
	/** Adds an advanced tool to the loaded set; false for a name that is not one. */
	const load = (name: string) => {
		if (!ADVANCED.some((t) => t.name === name)) return false;
		loaded.add(name);
		return true;
	};
	/**
	 * The run's project is not the model's to pick: the field stays (descriptions
	 * mention it) but is optional, and whatever it sends is replaced. A canvas
	 * `target` carries one too, for a sandbox.
	 */
	const wrap = (t: McpTool): Tool => {
		const own = "projectId" in t.input;
		const shape = own ? { ...t.input, projectId: PROJECT_FIELD } : t.input;
		const pin = (args: any) => ({
			...args,
			...(own && { projectId }),
			...("target" in t.input && args.target && { target: { ...args.target, projectId } }),
		});
		return tool({
			title: t.title,
			description: t.description,
			inputSchema: z.object(lenient(shape)),
			execute: (args, { abortSignal }) =>
				t.call(adminApi(fetcher, auth, t.role, abortSignal), pin(args)),
		});
	};
	const tools: Record<string, Tool> = Object.fromEntries(
		ALL.filter((t) => !COVERED.has(t.name)).map((t) => [t.name, wrap(t)]),
	);

	tools.list = tool({
		title: AGENT_TITLES.list,
		description: `List several resource types of this project in one call: ${Object.keys(LIST_TYPES).join(", ")}.`,
		inputSchema: z.object({
			types: z.array(z.enum(Object.keys(LIST_TYPES) as [keyof typeof LIST_TYPES])).min(1),
		}),
		execute: async ({ types }, { abortSignal }) =>
			Object.fromEntries(
				await Promise.all(
					types.map(async (type) => [
						type,
						await run(LIST_TYPES[type], { projectId }, abortSignal).catch((e: Error) => ({
							error: e.message,
						})),
					]),
				),
			),
	});
	tools.get = tool({
		title: AGENT_TITLES.get,
		description: `Read one resource by id: ${Object.keys(GET_TYPES).join(", ")}. Canvases come from get_canvas.`,
		inputSchema: z.object({
			type: z.enum(Object.keys(GET_TYPES) as [keyof typeof GET_TYPES]),
			id: z.string(),
			env: envInput(
				"app_config and integration only: development returns the development value or config",
			),
		}),
		execute: ({ type, id, env }, { abortSignal }) => {
			const [name, key] = GET_TYPES[type];
			const withEnv = type === "app_config" || type === "integration" ? { env } : {};
			return run(
				name,
				{ projectId, [key]: type === "app_config" ? Number(id) : id, ...withEnv },
				abortSignal,
			);
		},
	});
	tools.list_advanced_tools = tool({
		title: AGENT_TITLES.list_advanced_tools,
		description:
			"More tools (deletes, members, packages, integrations, recordings list, …) with one line each. Load them with load_tools.",
		inputSchema: z.object({}),
		execute: async () => ADVANCED.map((t) => `${t.name}: ${t.description.split(". ")[0]}`),
	});
	tools.load_tools = tool({
		title: AGENT_TITLES.load_tools,
		description:
			"Make advanced tools callable from your next step. Names from list_advanced_tools.",
		inputSchema: z.object({ names: z.array(z.string()).min(1) }),
		execute: async ({ names }) => {
			const known = names.filter(load);
			return { loaded: known, unknown: names.filter((n) => !known.includes(n)) };
		},
	});
	return { tools, active: () => [...CORE, ...loaded], load };
}

/** Up to 5 tool names that share a word with `name` (read_route ~ get_route), for the unknown-tool error. */
export function closeMatches(name: string) {
	const words = name.split("_").filter((w) => w.length > 2);
	return [...CORE, ...ADVANCED.map((t) => t.name)]
		.filter((n) => words.some((w) => n.split("_").includes(w)))
		.slice(0, 5);
}

/**
 * The tools added in a stored conversation: a web run is one job
 * per message or approval, so the set the CLI keeps in memory (#672) is
 * rebuilt from the saved calls: load_tools names, and advanced tools the model
 * called directly (auto-loaded, #699). Unknown names are dropped, as load_tools does.
 */
export function loadedTools(history: ModelMessage[]) {
	const loaded = new Set<string>();
	for (const m of history) {
		if (m.role !== "assistant" || typeof m.content === "string") continue;
		for (const p of m.content) {
			if (p.type !== "tool-call") continue;
			if (p.toolName !== "load_tools") {
				if (ADVANCED.some((t) => t.name === p.toolName)) loaded.add(p.toolName);
				continue;
			}
			const names = (p.input as { names?: unknown })?.names;
			if (!Array.isArray(names)) continue;
			for (const n of names) if (ADVANCED.some((t) => t.name === n)) loaded.add(n);
		}
	}
	return loaded;
}

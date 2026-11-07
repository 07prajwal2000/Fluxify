import { blockAiDescriptions } from "@fluxify/blocks";
import type { AdminApi } from "../../mcp/adminApi";
import type { CanvasItems } from "../../mcp/canvasNormalize";
import { canvasTools, read } from "../../mcp/canvasTools";
import { readTools } from "../../mcp/tools";
import type { ReviewKind } from "./repository";

const TOOLS = [...readTools, ...canvasTools];
/** Suites past this many are named, not read. */
const MAX_SUITES = 20;
const BUILTIN = new Map<string, string>(blockAiDescriptions.map((b) => [b.name, b.description]));

/** One read-only tool, the same answer the agent gets from it. */
const call = (api: AdminApi, name: string, args: Record<string, unknown>) =>
	TOOLS.find((t) => t.name === name)!.call(api, args);

/** A part the caller may not read (say, integrations for a viewer) is left out, not fatal. */
const optional = <T>(p: Promise<T>) => p.catch(() => undefined);

/**
 * Everything a review reads about one route or workflow, through the same
 * read-only tools the agent uses, so app config and integration values never
 * leave the server: their keys and names only. `blocks` is the raw canvas, for
 * mapping the keys the model names back to block ids.
 */
export async function reviewContext(
	api: AdminApi,
	projectId: string,
	kind: ReviewKind,
	id: string,
) {
	const target = { kind, id };
	const canvas = (await read(api.get, target)) as CanvasItems & { canvasRevision: number };
	const detail: any = await call(
		api,
		kind === "route" ? "get_route" : "get_workflow",
		kind === "route" ? { routeId: id } : { workflowId: id },
	);
	const [view, suites, customBlocks, appConfig, integrations] = await Promise.all([
		call(api, "get_canvas", { target }),
		testSuites(api, kind, id),
		optional(call(api, "list_custom_blocks", { projectId }) as Promise<any[]>),
		optional(call(api, "list_app_config", { projectId }) as Promise<any>),
		optional(call(api, "list_integrations", { projectId }) as Promise<any[]>),
	]);

	const middlewares = await Promise.all(
		[...(detail.middlewares?.before ?? []), ...(detail.middlewares?.after ?? [])].map((m) =>
			optional(call(api, "get_middleware", { middlewareId: m.id })),
		),
	);
	// a custom block runs by name on a canvas; middlewares chain them by id
	const types = new Set(canvas.blocks.map((b) => b.type));
	const used = (customBlocks ?? []).filter(
		(b) =>
			types.has(b.name) || middlewares.some((m: any) => m?.blocks.some((x: any) => x.id === b.id)),
	);
	// ponytail: one level deep; a custom block used only inside another custom block is not read
	const customBlockDetails = await Promise.all(
		used.map(async (b) => ({
			...((await optional(call(api, "get_custom_block", { customBlockId: b.id }))) as object),
			canvas: await optional(
				call(api, "get_canvas", { target: { kind: "custom_block", id: b.id } }),
			),
		})),
	);

	return {
		revision: canvas.canvasRevision,
		blocks: canvas.blocks,
		context: {
			[kind]: detail,
			canvas: view,
			blockTypes: Object.fromEntries(
				[...types].filter((t) => BUILTIN.has(t)).map((t) => [t, BUILTIN.get(t)]),
			),
			middlewares: middlewares.filter(Boolean),
			customBlocks: customBlockDetails,
			testSuites: suites,
			appConfigKeys: appConfig?.items.map((c: any) => c.keyName),
			integrations: integrations?.map(({ id, name, group, variant }) => ({
				id,
				name,
				group,
				variant,
			})),
		},
	};
}

async function testSuites(api: AdminApi, kind: ReviewKind, id: string) {
	const list = (await optional(
		call(api, "list_test_suites", { targetType: kind, targetId: id }) as Promise<any[]>,
	)) as { id: string; name: string }[] | undefined;
	if (!list) return [];
	const read = await Promise.all(
		list
			.slice(0, MAX_SUITES)
			.map((s) => optional(call(api, "get_test_suite", { testSuiteId: s.id }))),
	);
	return [...read.filter(Boolean), ...list.slice(MAX_SUITES).map((s) => ({ name: s.name }))];
}

import { customBlocksQuery } from "@/query/customBlocksQuery";
import { middlewaresQuery } from "@/query/middlewaresQuery";
import { routesQuery } from "@/query/routesQuery";
import { workflowsQuery } from "@/query/workflowsQuery";
import type { VersionKind } from "@/services/versions";

type RouteData = NonNullable<ReturnType<typeof routesQuery.byId.useQuery>["data"]>;
type WorkflowData = NonNullable<ReturnType<typeof workflowsQuery.byId.useQuery>["data"]>;
type BlockData = NonNullable<ReturnType<typeof customBlocksQuery.byId.useQuery>["data"]>;
type MiddlewareData = NonNullable<ReturnType<typeof middlewaresQuery.get.useQuery>["data"]>;

/** What to call a target in a dialog: a route by name or method and path, a block by its label. */
function targetName(
	kind: VersionKind,
	route: RouteData | undefined,
	workflow: WorkflowData | undefined,
	block: BlockData | undefined,
	middleware: MiddlewareData | undefined,
) {
	if (kind === "route") {
		if (route?.name) return route.name;
		if (route?.method && route?.path) return `${route.method.toUpperCase()} ${route.path}`;
		return "Untitled route";
	}
	if (kind === "workflow") return workflow?.name || "Untitled workflow";
	if (kind === "custom_block") return block?.label || block?.name || "Untitled block";
	return middleware?.name || "Untitled middleware";
}

/**
 * Where a route, workflow, custom block or middleware stands against its versions
 * (#738, #740): what the header's Prod chip and Commit dot read, whichever it is.
 */
export function useVersionTarget(kind: VersionKind, id: string) {
	const route = routesQuery.byId.useQuery(kind === "route" ? id : "");
	const workflow = workflowsQuery.byId.useQuery(kind === "workflow" ? id : "");
	const block = customBlocksQuery.byId.useQuery(kind === "custom_block" ? id : "");
	const middleware = middlewaresQuery.get.useQuery(kind === "middleware" ? id : "");
	const data =
		kind === "route"
			? route.data
			: kind === "workflow"
				? workflow.data
				: kind === "custom_block"
					? block.data
					: middleware.data;
	return {
		/** what to call it: a route by its name or its method and path */
		name: targetName(kind, route.data, workflow.data, block.data, middleware.data),
		/** null until the first commit or checkout */
		headVersionNumber: data?.headVersionNumber ?? null,
		/** the version production serves (#739); null until the first promote */
		prodVersionNumber: data?.prodVersionNumber ?? null,
		/** the working copy holds changes no version does */
		uncommitted: data?.uncommitted ?? false,
	};
}

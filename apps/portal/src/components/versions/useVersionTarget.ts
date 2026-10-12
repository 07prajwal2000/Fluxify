import { routesQuery } from "@/query/routesQuery";
import { workflowsQuery } from "@/query/workflowsQuery";
import type { VersionKind } from "@/services/versions";

/** Where a route or workflow stands against its versions (#738), whichever it is. */
export function useVersionTarget(kind: VersionKind, id: string) {
	const route = routesQuery.byId.useQuery(kind === "route" ? id : "");
	const workflow = workflowsQuery.byId.useQuery(kind === "workflow" ? id : "");
	const data = kind === "route" ? route.data : workflow.data;
	return {
		/** what to call it: a route by its name or its method and path */
		name:
			kind === "route"
				? route.data?.name || `${route.data?.method.toUpperCase()} ${route.data?.path}`
				: workflow.data?.name || "Untitled",
		/** null until the first commit or checkout */
		headVersionNumber: data?.headVersionNumber ?? null,
		/** the version production serves (#739); null until the first promote */
		prodVersionNumber: data?.prodVersionNumber ?? null,
		/** the working copy holds changes no version does */
		uncommitted: data?.uncommitted ?? false,
	};
}

import { useParams } from "@tanstack/react-router";
import { routesQuery } from "@/query/routesQuery";
import { workflowsQuery } from "@/query/workflowsQuery";
import { customBlocksQuery } from "@/query/customBlocksQuery";

export type SpotlightRouteItem = {
	id: string;
	name: string | null;
	method: string;
	path: string;
};

export type SpotlightWorkflowItem = {
	id: string;
	name: string;
	description: string | null;
	active: boolean;
};

export type SpotlightCustomBlockItem = {
	id: string;
	name: string;
	label: string | null;
	description: string | null;
};

export type SpotlightResources = {
	projectId: string;
	routes: SpotlightRouteItem[];
	workflows: SpotlightWorkflowItem[];
	customBlocks: SpotlightCustomBlockItem[];
};

export function useSpotlightResources(): SpotlightResources {
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params?.projectId ?? "";

	const routesRes = routesQuery.getAll.useQuery({
		projectId,
		perPage: 50,
	});

	const workflowsRes = workflowsQuery.getAll.useQuery({
		projectId,
		perPage: 50,
	});

	const customBlocksRes = customBlocksQuery.getAll.useQuery(projectId);

	const routes: SpotlightRouteItem[] = (routesRes.data?.data ?? []).map((r) => ({
		id: r.id,
		name: r.name ?? null,
		method: r.method ?? "GET",
		path: r.path ?? "",
	}));

	const workflows: SpotlightWorkflowItem[] = (workflowsRes.data?.data ?? []).map((w) => ({
		id: w.id,
		name: w.name ?? "Untitled workflow",
		description: w.description ?? null,
		active: Boolean(w.active),
	}));

	const customBlocks: SpotlightCustomBlockItem[] = (customBlocksRes.data ?? []).map((b) => ({
		id: b.id,
		name: b.name,
		label: b.label ?? null,
		description: b.description ?? null,
	}));

	return {
		projectId,
		routes,
		workflows,
		customBlocks,
	};
}

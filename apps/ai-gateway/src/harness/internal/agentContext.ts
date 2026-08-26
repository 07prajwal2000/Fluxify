import type {
	ProjectInventoryEntry,
	RouteConfigAgentResult,
	SubAgentResult,
	Task,
} from "../types";
import { renderProjectInventory } from "./projectInventory";
import { fenceUntrusted } from "./untrusted";

type AgentContextOptions = {
	currentContext?: string;
	projectInventory?: ProjectInventoryEntry[];
	activeTask?: Task;
	subAgentResults?: Record<string, SubAgentResult>;
};

function dependencyContext(
	task: Task | undefined,
	results: Record<string, SubAgentResult> | undefined,
): { output?: string; values: SubAgentResult[] } {
	const values = [...new Set(task?.dependsOnAgentId ?? [])]
		.flatMap((taskId) => {
			const result = results?.[taskId];
			return result === undefined ? [] : [{ taskId, result }];
		});
	if (values.length === 0) return { values: [] };

	return {
		values: values.map(({ result }) => result),
		output: `## Direct task dependencies
${fenceUntrusted("dependent_agent_outputs", JSON.stringify(values))}
These completed outputs are authoritative for this task. Use their IDs and configuration directly; do NOT call get_agent_output to retrieve them again. A direct dependency takes precedence over an unrelated current canvas.`,
	};
}

function plannedNewRouteContext(values: SubAgentResult[]): string | undefined {
	const route = values.find(
		(value): value is RouteConfigAgentResult =>
			(value as RouteConfigAgentResult).action === "create" &&
			typeof (value as RouteConfigAgentResult).routeId === "string",
	);
	if (!route?.routeId) return undefined;

	return `## Planned target canvas
${fenceUntrusted(
	"planned_route_canvas",
	JSON.stringify({
		targetType: "route",
		targetId: route.routeId,
		route: route.data,
		canvas: [],
	}),
)}
This route is new and is not in the database yet. Its canvas is empty: create its required initial blocks and do NOT fetch an unrelated existing route canvas.`;
}

/** Builds one volatile context bundle for agents that need workspace data. */
export function buildAgentContext({
	currentContext,
	projectInventory,
	activeTask,
	subAgentResults,
}: AgentContextOptions): string | undefined {
	const dependencies = dependencyContext(activeTask, subAgentResults);
	const sections = [
		currentContext,
		renderProjectInventory(projectInventory),
		dependencies.output,
		plannedNewRouteContext(dependencies.values),
	].filter((section): section is string => Boolean(section));
	return sections.length ? sections.join("\n\n") : undefined;
}

import type { ProjectInventoryEntry, SubAgentResult, Task } from "../types";
import { renderProjectInventory } from "./projectInventory";
import { fenceUntrusted } from "./untrusted";

type AgentContextOptions = {
	currentContext?: string;
	projectInventory?: ProjectInventoryEntry[];
	activeTask?: Task;
	subAgentResults?: Record<string, SubAgentResult>;
	targetCanvas?: string;
};

function dependencyContext(
	task: Task | undefined,
	results: Record<string, SubAgentResult> | undefined,
): string | undefined {
	const values = [...new Set(task?.dependsOnAgentId ?? [])]
		.flatMap((taskId) => {
			const result = results?.[taskId];
			return result === undefined ? [] : [{ taskId, result }];
		});
	if (values.length === 0) return undefined;

	return `## Direct task dependencies
${fenceUntrusted("dependent_agent_outputs", JSON.stringify(values))}
These completed outputs are authoritative for this task. Use their IDs and configuration directly; do NOT call get_agent_output to retrieve them again. A direct dependency takes precedence over an unrelated current canvas.`;
}

/** Builds one volatile context bundle for agents that need workspace data.
 *  `targetCanvas` is the canvas this task edits, when the caller could resolve
 *  it without the model — see `buildTargetCanvasContext`. */
export function buildAgentContext({
	currentContext,
	projectInventory,
	activeTask,
	subAgentResults,
	targetCanvas,
}: AgentContextOptions): string | undefined {
	const sections = [
		currentContext,
		targetCanvas,
		renderProjectInventory(projectInventory),
		dependencyContext(activeTask, subAgentResults),
	].filter((section): section is string => Boolean(section));
	return sections.length ? sections.join("\n\n") : undefined;
}

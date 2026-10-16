import type { ToolPart } from "../agentMessages";
import { TodoItems } from "../TodoList";
import { todosOf } from "../todos";
import { rec, str } from "./data";
import { Notice } from "./Notice";

/** update_todos (#771): the whole list it left, and the task to do next. */
export function TodosPreview({ tool }: { tool: ToolPart }) {
	const todos = todosOf(tool) ?? [];
	const next = rec(rec(tool.output).next);
	return (
		<div className="flex flex-col gap-2 text-xs">
			{todos.length ? (
				<TodoItems todos={todos} />
			) : (
				<p className="text-muted">The list is empty.</p>
			)}
			{str(next.id) && (
				<p className="text-muted">
					Next: <span className="font-mono">{str(next.id)}</span>{" "}
					<span className="text-foreground">{str(next.text)}</span>
				</p>
			)}
		</div>
	);
}

/** What the user said to suggest_plan_mode, from its result. */
function answerOf(tool: ToolPart, asking: boolean) {
	if (tool.status === "rejected") return `Turned down${tool.error ? `: ${tool.error}` : ""}`;
	const out = str(tool.output);
	if (out.startsWith("User switched to plan")) return "Switched to plan mode";
	if (out.startsWith("User chose to continue")) return "Continued without a plan";
	return asking ? "Waiting for your answer" : undefined;
}

/** suggest_plan_mode (#771): why the agent wants a plan first, and the answer once given. */
export function SuggestPlanPreview({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	const answer = answerOf(tool, asking);
	return (
		<div className="flex flex-col gap-2 text-xs">
			<Notice>{str(rec(tool.input).reason) || "The agent suggests planning first."}</Notice>
			{answer && <p className="font-medium text-foreground">{answer}</p>}
		</div>
	);
}

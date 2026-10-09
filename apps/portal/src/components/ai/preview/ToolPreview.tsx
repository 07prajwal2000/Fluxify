import type { ReactNode } from "react";
import type { ToolPart } from "../agentMessages";
import { CallRoutePreview } from "./CallRoutePreview";
import { DataPreview, hasData } from "./DataPreview";
import { DeleteCard } from "./DeleteCard";
import { EditCanvasPreview } from "./EditCanvasPreview";
import { ResourceCard } from "./ResourceCard";
import { resourceOf } from "./resourceMeta";
import { TestRunPreview } from "./TestRunPreview";

/** Reads: the agent's `list` / `get`, and every get_* / list_* tool. */
const isRead = (name: string) => /^(get|list)(_|$)/.test(name);

/**
 * The preview of a tool call, or nothing for a tool without one (it shows Raw only).
 * `asking`: it waits for an answer, so its card shows what it would do.
 */
export function previewOf(tool: ToolPart, asking: boolean): ReactNode | null {
	const { name } = tool;
	if (name === "edit_canvas") return <EditCanvasPreview tool={tool} asking={asking} />;
	if (name === "call_route") return <CallRoutePreview tool={tool} />;
	if (name === "run_test_suite" || name === "get_test_runs") return <TestRunPreview tool={tool} />;
	const res = resourceOf(name);
	if (res?.verb === "save") return <ResourceCard tool={tool} asking={asking} />;
	if (res?.verb === "delete") return <DeleteCard tool={tool} asking={asking} />;
	if (isRead(name) && hasData(tool.output)) return <DataPreview tool={tool} />;
	return null;
}

import type { ReactNode } from "react";
import type { ToolPart } from "../agentMessages";
import { CallRoutePreview } from "./CallRoutePreview";
import { DataPreview, hasData } from "./DataPreview";
import { DeleteCard } from "./DeleteCard";
import { isRec } from "./data";
import { EditCanvasPreview } from "./EditCanvasPreview";
import { canDraw, GetCanvasPreview } from "./GetCanvasPreview";
import { isRun, RecordingList, RecordingSummary } from "./RecordingPreview";
import { ResourceCard } from "./ResourceCard";
import { resourceOf } from "./resourceMeta";
import {
	hasConfigFields,
	IntegrationSchemaPreview,
	isSchemaDetails,
	SchemaDetailsPreview,
} from "./SchemaPreview";
import { TestRunPreview } from "./TestRunPreview";
import {
	AdvancedToolsPreview,
	isLoadResult,
	isToolLines,
	LoadedToolsPreview,
} from "./ToolListPreview";

/** Reads: the agent's `list` / `get`, and every get_* / list_* tool. */
const isRead = (name: string) => /^(get|list)(_|$)/.test(name);

/**
 * The preview of a tool call, or nothing for a tool without one (it shows Raw only).
 * `asking`: it waits for an answer, so its card shows what it would do.
 */
export function previewOf(tool: ToolPart, asking: boolean): ReactNode | null {
	const { name } = tool;
	if (name === "edit_canvas") return <EditCanvasPreview tool={tool} asking={asking} />;
	if (name === "get_canvas" && canDraw(tool)) return <GetCanvasPreview tool={tool} />;
	if (name === "list_recordings" && isRec(tool.output)) return <RecordingList tool={tool} />;
	if (name === "get_recording" && isRun(tool.output)) return <RecordingSummary tool={tool} />;
	if (name === "list_advanced_tools" && isToolLines(tool.output))
		return <AdvancedToolsPreview tool={tool} />;
	if (name === "load_tools" && isLoadResult(tool.output)) return <LoadedToolsPreview tool={tool} />;
	if (name === "get_integration_schema_details" && isSchemaDetails(tool.output))
		return <SchemaDetailsPreview tool={tool} />;
	if (name === "get_integration_schema" && hasConfigFields(tool.output))
		return <IntegrationSchemaPreview tool={tool} />;
	if (name === "call_route") return <CallRoutePreview tool={tool} />;
	if (name === "run_test_suite" || name === "get_test_runs") return <TestRunPreview tool={tool} />;
	const res = resourceOf(name);
	if (res?.verb === "save") return <ResourceCard tool={tool} asking={asking} />;
	if (res?.verb === "delete") return <DeleteCard tool={tool} asking={asking} />;
	if (isRead(name) && hasData(tool.output)) return <DataPreview tool={tool} />;
	return null;
}

import type { ReactNode } from "react";
import { SUGGEST_PLAN } from "../agentApproval";
import type { ToolPart } from "../agentMessages";
import { TODO_TOOL, todosOf } from "../todos";
import { BlockSchemasPreview } from "./BlockSchemasPreview";
import { CallRoutePreview } from "./CallRoutePreview";
import { ConnectionPreview } from "./ConnectionPreview";
import { CopyBlocksPreview } from "./CopyBlocksPreview";
import { DataPreview, hasData } from "./DataPreview";
import { DeleteCard } from "./DeleteCard";
import { DocsPreview, isDocsTool } from "./DocsPreview";
import { isRec } from "./data";
import { EditCanvasPreview } from "./EditCanvasPreview";
import { canDraw, GetCanvasPreview } from "./GetCanvasPreview";
import { KvPreview } from "./KvPreview";
import { MemberPreview } from "./MemberPreview";
import { PackagePreview } from "./PackagePreview";
import { SuggestPlanPreview, TodosPreview } from "./PlanPreviews";
import { ProjectUpdatePreview } from "./ProjectUpdatePreview";
import { isRun, RecordingList, RecordingSummary } from "./RecordingPreview";
import { ResourceCard } from "./ResourceCard";
import { resourceOf } from "./resourceMeta";
import { SandboxRunPreview } from "./SandboxRunPreview";
import {
	hasConfigFields,
	IntegrationSchemaPreview,
	isSchemaDetails,
	SchemaDetailsPreview,
} from "./SchemaPreview";
import { SuiteActionPreview } from "./SuiteActionPreview";
import { TestRunPreview } from "./TestRunPreview";
import {
	AdvancedToolsPreview,
	isLoadResult,
	isToolLines,
	LoadedToolsPreview,
} from "./ToolListPreview";
import { VersionCard } from "./VersionCard";
import { WhoamiPreview } from "./WhoamiPreview";

/** Reads: the agent's `list` / `get`, and every get_* / list_* tool. */
const isRead = (name: string) => /^(get|list)(_|$)/.test(name);

const isMember = (name: string) =>
	name === "add_member" || name === "update_member_role" || name === "remove_member";
const isPackage = (name: string) => name === "install_package" || name === "remove_package";
const isSuiteAction = (name: string) =>
	name === "validate_test_suite" || name === "clone_test_suite";

/**
 * The preview of a tool call, or nothing for a tool without one (it shows Raw only).
 * `asking`: it waits for an answer, so its card shows what it would do.
 */
export function previewOf(tool: ToolPart, asking: boolean): ReactNode | null {
	const { name } = tool;
	if (name === SUGGEST_PLAN) return <SuggestPlanPreview tool={tool} asking={asking} />;
	if (name === TODO_TOOL && todosOf(tool)) return <TodosPreview tool={tool} />;
	if (name === "copy_blocks") return <CopyBlocksPreview tool={tool} asking={asking} />;
	if (name === "run_sandbox") return <SandboxRunPreview tool={tool} asking={asking} />;
	if (isMember(name)) return <MemberPreview tool={tool} asking={asking} />;
	if (isPackage(name)) return <PackagePreview tool={tool} asking={asking} />;
	if (name === "update_project") return <ProjectUpdatePreview tool={tool} asking={asking} />;
	if (isSuiteAction(name)) return <SuiteActionPreview tool={tool} asking={asking} />;
	if (name === "kv_get") return <KvPreview tool={tool} />;
	if (name === "whoami" && isRec(tool.output)) return <WhoamiPreview tool={tool} />;
	if (name === "get_block_schemas" && typeof tool.output === "string")
		return <BlockSchemasPreview tool={tool} />;
	if (name === "get_version" || name === "commit_version") return <VersionCard tool={tool} />;
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
	if (isDocsTool(name) && typeof tool.output === "string") return <DocsPreview tool={tool} />;
	if (name === "test_integration_connection") return <ConnectionPreview tool={tool} />;
	if (name === "call_route" || name === "call_sandbox" || name === "run_blocks")
		return <CallRoutePreview tool={tool} />;
	if (name === "run_test_suite" || name === "get_test_runs") return <TestRunPreview tool={tool} />;
	const res = resourceOf(name);
	if (res?.verb === "save" || res?.verb === "create")
		return <ResourceCard tool={tool} asking={asking} />;
	if (res?.verb === "delete") return <DeleteCard tool={tool} asking={asking} />;
	if (isRead(name) && hasData(tool.output)) return <DataPreview tool={tool} />;
	return null;
}

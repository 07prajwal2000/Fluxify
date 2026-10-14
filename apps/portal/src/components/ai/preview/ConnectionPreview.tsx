import { TbCheck } from "react-icons/tb";
import { AgentRef } from "../AgentRef";
import type { ToolPart } from "../agentMessages";
import { rec, str } from "./data";
import { Notice } from "./Notice";

/**
 * test_integration_connection (#780): Success, or Failure with the reason. A
 * failure that came back as the tool's own error keeps its message in the row
 * above (ToolBody shows it); this then shows the word alone.
 */
export function ConnectionPreview({ tool }: { tool: ToolPart }) {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const id = str(input.integrationId);
	const what = str(input.variant) || "integration";
	const success = out.success === true;
	const outputError = out.success === false ? str(out.error) : "";
	const failed = out.success === false || tool.error !== undefined;
	return (
		<div className="flex flex-col gap-2 text-xs">
			<p className="flex flex-wrap items-center gap-2">
				{id ? (
					<AgentRef type="integration" id={id}>
						Integration
					</AgentRef>
				) : (
					<span className="font-medium text-foreground">{what}</span>
				)}
				{success && (
					<span className="flex items-center gap-1 text-success">
						<TbCheck size={14} /> Success
					</span>
				)}
				{failed && !outputError && <span className="font-medium text-danger">Failure</span>}
			</p>
			{outputError && <Notice tone="danger">Failure: {outputError}</Notice>}
		</div>
	);
}

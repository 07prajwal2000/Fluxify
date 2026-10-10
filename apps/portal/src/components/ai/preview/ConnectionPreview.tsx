import { TbCheck } from "react-icons/tb";
import { AgentRef } from "../AgentRef";
import type { ToolPart } from "../agentMessages";
import { rec, str } from "./data";
import { Notice } from "./Notice";

/** test_integration_connection: connected or not, with the reason. A saved integration links to its page. */
export function ConnectionPreview({ tool }: { tool: ToolPart }) {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const id = str(input.integrationId);
	const what = str(input.variant) || "integration";
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
				{out.success === true && (
					<span className="flex items-center gap-1 text-success">
						<TbCheck size={14} /> Connected
					</span>
				)}
			</p>
			{out.success === false && (
				<Notice tone="danger">Could not connect{out.error ? `: ${str(out.error)}` : "."}</Notice>
			)}
		</div>
	);
}

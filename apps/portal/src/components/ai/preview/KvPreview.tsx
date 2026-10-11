import { TbSquareKey } from "react-icons/tb";
import { AgentRef } from "../AgentRef";
import type { ToolPart } from "../agentMessages";
import { JsonBlock } from "./Collapsible";
import { rec, str } from "./data";
import { Notice } from "./Notice";

/** Previews kv_get: key name, value display, TTL, and link to the integration. */
export function KvPreview({ tool }: { tool: ToolPart }) {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const key = str(input.key);
	const integrationId = str(input.integrationId);
	const ttl = typeof out.ttl === "number" ? out.ttl : undefined;
	const truncated = out.truncated === true;

	return (
		<div className="flex flex-col gap-2 text-xs">
			<header className="flex flex-wrap items-center gap-2 text-sm">
				<TbSquareKey size={16} className="shrink-0 text-muted" />
				<span className="font-mono font-medium text-foreground">{key}</span>
				{integrationId && (
					<span className="ml-auto">
						<AgentRef type="integration" id={integrationId}>
							Open integration
						</AgentRef>
					</span>
				)}
			</header>
			{ttl !== undefined && (
				<p className="text-xs text-muted">
					Expires in: <span className="font-mono text-foreground">{ttl}s</span>
				</p>
			)}
			{truncated && <Notice tone="warning">Value was truncated to 10,000 characters.</Notice>}
			{out.value !== undefined && <JsonBlock label="Value" value={out.value} />}
		</div>
	);
}

import type { ToolPart } from "../agentMessages";
import { JsonBlock } from "./Collapsible";
import { rec, str } from "./data";
import { Notice } from "./Notice";
import { ResourceHeader } from "./ResourceHeader";

/** Previews run_sandbox: target sandbox link, run id/status, and payload. */
export function SandboxRunPreview({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const sandboxId = str(input.sandboxId);
	const runId = str(out.runId) || str(out.id);

	return (
		<div className="flex flex-col gap-2">
			{sandboxId && (
				<ResourceHeader
					type="sandbox"
					id={sandboxId}
					name={`Sandbox ${sandboxId.slice(0, 8)}`}
					badge="saved"
				/>
			)}
			{asking ? (
				<Notice tone="warning">
					This action will queue a run on sandbox <strong>{sandboxId}</strong> on the development
					worker.
				</Notice>
			) : (
				<div className="flex items-center gap-2 text-xs">
					<span className="rounded-full border border-success/50 bg-success/10 px-2 py-0.5 font-medium text-success">
						Queued
					</span>
					{runId && <span className="font-mono text-muted">Run ID: {runId}</span>}
				</div>
			)}
			{input.payload !== undefined && <JsonBlock label="Payload" value={input.payload} />}
		</div>
	);
}

import type { ToolPart } from "../agentMessages";

const json = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v, null, 2) ?? ""));

/** The call as raw JSON: its input, then the error or the result. What the chat always showed. */
export function RawView({ tool }: { tool: ToolPart }) {
	return (
		<div className="flex flex-col gap-2">
			<pre className="max-h-64 overflow-auto whitespace-pre-wrap text-muted">
				{json(tool.input)}
			</pre>
			{tool.error !== undefined && (
				<pre className="max-h-64 overflow-auto whitespace-pre-wrap text-danger">{tool.error}</pre>
			)}
			{tool.output !== undefined && (
				<pre className="max-h-64 overflow-auto whitespace-pre-wrap text-foreground/80">
					{json(tool.output)}
				</pre>
			)}
		</div>
	);
}

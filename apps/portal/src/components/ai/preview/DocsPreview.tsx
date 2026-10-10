import type { ToolPart } from "../agentMessages";
import { MarkdownViewer } from "../MarkdownViewer";
import { rec, str } from "./data";

export const isDocsTool = (name: string) => name === "read_doc" || name === "search_docs";

/** What the agent asked the docs, as a line: the keywords, or the page and its section. Undefined for other tools. */
export function docsInput(tool: ToolPart) {
	const input = rec(tool.input);
	if (tool.name === "search_docs")
		return (Array.isArray(input.queries) ? input.queries : []).map(str).filter(Boolean).join(", ");
	if (tool.name === "read_doc")
		return [str(input.page), str(input.heading)].filter(Boolean).join(" › ");
}

/** The index's `[page: x | Title > Heading]` marker as a bold line; the page and heading are already known to the reader. */
const readable = (text: string) => text.replace(/^\[page: (.*)\]$/gm, "**$1**");

/** read_doc and search_docs: what was asked, then the docs text as markdown. */
export function DocsPreview({ tool }: { tool: ToolPart }) {
	const asked = docsInput(tool);
	const output = typeof tool.output === "string" ? tool.output : "";
	// a page read says which one in the line above, so its marker is not repeated
	const text = readable(tool.name === "read_doc" ? output.replace(/^\[page: .*\]\n+/, "") : output);
	return (
		<div className="flex flex-col gap-2">
			{asked && (
				<p className="text-xs text-muted">
					{tool.name === "search_docs" ? "Searched for: " : "Read: "}
					<span className="font-medium text-foreground">{asked}</span>
				</p>
			)}
			<div className="max-h-96 overflow-auto rounded-md border border-border bg-surface px-3 py-2">
				<MarkdownViewer content={text} />
			</div>
		</div>
	);
}

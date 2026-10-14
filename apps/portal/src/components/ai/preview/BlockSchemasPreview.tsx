import type { ToolPart } from "../agentMessages";
import { MarkdownViewer } from "../MarkdownViewer";
import { str } from "./data";

/**
 * get_block_schemas (#780): the bare list is the markdown table it arrives as;
 * with blockTypes, each block's contract gets its own box — one block per
 * section, lines kept — instead of one compacted blob.
 */
export function BlockSchemasPreview({ tool }: { tool: ToolPart }) {
	const text = str(tool.output).trim();
	if (!text) return null;
	if (text.startsWith("|")) return <MarkdownViewer content={text} />;
	const blocks = text.split("\n\n").filter((b) => b.trim());
	return (
		<div className="flex max-h-96 flex-col gap-2 overflow-auto">
			{blocks.map((block) => {
				const [first, ...rest] = block.split("\n");
				const type = first.split(/\s+/)[0];
				return (
					<section key={type} className="rounded-md border border-border bg-surface px-3 py-2">
						<p className="font-mono text-xs font-medium text-foreground">{type}</p>
						<pre className="whitespace-pre-wrap font-mono text-xs text-muted">
							{[first.slice(type.length).trim(), ...rest].filter(Boolean).join("\n")}
						</pre>
					</section>
				);
			})}
		</div>
	);
}

import { Spinner } from "@fluxify/components";
import { useEffect, useState } from "react";
import { TbBan, TbCheck, TbClock, TbX } from "react-icons/tb";
import { type ToolPart, toolTitle } from "./agentMessages";
import { CanvasTarget, canvasOf } from "./preview/CanvasTarget";
import { docsInput } from "./preview/DocsPreview";
import { oneLine } from "./preview/data";
import { ToolBody } from "./preview/ToolBody";
import { isDone } from "./preview/tool";
import { copyBlocksHeader, toolSummary } from "./preview/toolHeader";

/** One tool call, folded: name, short input, duration; open for the preview (and the raw JSON). A call that waits for an answer opens by itself. */
export function ToolRow({
	tool,
	waiting,
	running,
}: {
	tool: ToolPart;
	waiting: boolean;
	running: boolean;
}) {
	const asking = !isDone(tool) && (tool.approval === true || waiting);
	// The body mounts only once open: a heavy preview (a canvas) must not cost the chat its scroll.
	const [open, setOpen] = useState(asking);
	useEffect(() => {
		if (asking) setOpen(true);
	}, [asking]);
	const canvas = canvasOf(tool);
	const ms = tool.startedAt && tool.endedAt ? tool.endedAt - tool.startedAt : undefined;
	return (
		<details
			className="group rounded-lg border border-border bg-surface text-xs"
			open={open}
			onToggle={(e) => setOpen(e.currentTarget.open)}
		>
			<summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5">
				{tool.status === "rejected" ? (
					<TbBan size={14} aria-label="Rejected" className="shrink-0 text-muted" />
				) : tool.status === "error" || tool.error !== undefined ? (
					<TbX size={14} aria-label="Failed" className="shrink-0 text-danger" />
				) : isDone(tool) ? (
					<TbCheck size={14} aria-label="Done" className="shrink-0 text-success" />
				) : asking ? (
					<TbClock size={14} className="shrink-0 text-warning" />
				) : running ? (
					<Spinner size="sm" color="current" />
				) : (
					<TbX size={14} className="shrink-0 text-muted" />
				)}
				{tool.name === "copy_blocks" ? (
					<span className="min-w-0 flex-1 truncate font-medium text-foreground">
						{copyBlocksHeader(tool, asking)}
					</span>
				) : (
					<>
						<span className="font-medium text-foreground">{toolTitle(tool)}</span>
						<span className="min-w-0 flex-1 truncate font-mono text-muted">
							{canvas ? (
								<CanvasTarget which={canvas} />
							) : (
								(toolSummary(tool, asking) ?? docsInput(tool) ?? oneLine(tool.input))
							)}
						</span>
					</>
				)}
				{ms !== undefined && <span className="shrink-0 text-muted">{(ms / 1000).toFixed(1)}s</span>}
			</summary>
			{/*
				Rejection reason: always visible under the summary, even when the card is collapsed.
				A future issue will rework the tool summary UI; this line is intentionally placed here
				so it won't be overridden by that change.
			*/}
			{tool.status === "rejected" && tool.error !== undefined && (
				<div className="px-3 py-1 text-xs text-muted">Rejected: {tool.error}</div>
			)}
			{open && (
				<div className="border-t border-border px-3 py-2">
					<ToolBody tool={tool} asking={asking} />
				</div>
			)}
		</details>
	);
}

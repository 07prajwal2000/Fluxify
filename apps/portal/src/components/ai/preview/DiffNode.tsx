import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { blockIcon } from "@/components/canvas/blocks/blockIconMap";
import { blockLabels } from "@/components/canvas/blocks/blockLabels";
import type { BlockStatus, DiffBlock } from "./canvasDiff";

export type DiffNodeData = { block: DiffBlock; selected: boolean };
export type DiffFlowNode = Node<DiffNodeData, "diff">;

const TONE: Record<BlockStatus, string> = {
	same: "border-border bg-surface",
	added: "border-success bg-success/10",
	removed: "border-dashed border-danger bg-danger/10 opacity-60",
	changed: "border-warning bg-warning/10",
};
export const STATUS_LABEL: Record<BlockStatus, string> = {
	same: "unchanged",
	added: "added",
	removed: "removed",
	changed: "changed",
};

/** A block in the diff: its key (what the agent calls it), the block's own name, a ring for what happened to it. */
export function DiffNode({ data }: NodeProps<DiffFlowNode>) {
	const { block, selected } = data;
	const { name } = blockLabels(block.type, block.data);
	return (
		<div
			data-block-key={block.key}
			data-status={block.status}
			title={`${block.key}: ${STATUS_LABEL[block.status]}`}
			className={`flex w-44 items-center gap-2 rounded-lg border px-2 py-1.5 text-xs text-foreground ${
				TONE[block.status]
			} ${selected ? "ring-2 ring-focus" : ""}`}
		>
			<Handle type="target" position={Position.Left} isConnectable={false} className="opacity-0" />
			<span className="shrink-0 text-muted">{blockIcon(block.type)}</span>
			<span className="flex min-w-0 flex-col">
				<span className="truncate font-mono font-medium">{block.key}</span>
				{name !== block.type && <span className="truncate text-muted">{name}</span>}
			</span>
			<Handle type="source" position={Position.Right} isConnectable={false} className="opacity-0" />
		</div>
	);
}

import type { NodeProps } from "@xyflow/react";
import { BlockNode } from "@/components/canvas/blocks";

/**
 * A block that ran in this recording but is gone from the canvas since (#628):
 * drawn at the position its span recorded, tinted by its outcome, dashed.
 */
export function GhostNode(props: NodeProps) {
	const { blockType, blockName, status } = props.data as {
		blockType: string;
		blockName: string | null;
		status?: boolean;
	};
	return (
		<div className="fx-run-ghost" title="This block was removed from the canvas after this run">
			<BlockNode {...props} type={blockType} data={{ blockName, status }} />
			<span className="mt-1 block text-center text-[10px] text-muted">Removed since this run</span>
		</div>
	);
}

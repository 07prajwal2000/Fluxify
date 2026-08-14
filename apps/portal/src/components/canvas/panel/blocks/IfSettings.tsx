import { ConditionsBuilder } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { BlockSettings } from "../BlockSettings";
import { useCanvasChanges } from "../../changes/ChangesContext";
import type { BlockNode } from "../../types";
import { parseIfConditions, serializeIfConditions } from "./ifConditions";

/** If block: the conditions deciding which branch the flow takes. */
export function IfSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	// Tracking disabled means a readonly canvas: show the conditions, don't edit.
	const { enabled: editable } = useCanvasChanges();

	return (
		<ConditionsBuilder
			collapsible={false}
			label="Conditions"
			description="True takes the success branch, false takes the failure branch."
			isDisabled={!editable}
			conditions={parseIfConditions(block)}
			onChange={(next) =>
				updateNodeData(block.id, { conditions: serializeIfConditions(next) })
			}
		/>
	);
}

export function ifSettings(block: BlockNode) {
	const count = parseIfConditions(block).length;
	return (
		<BlockSettings.TabHead
			name="Edit Conditions"
			title={
				<span className="inline-flex items-center gap-1.5">
					Edit Conditions
					<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-secondary text-muted-foreground border border-border leading-none">
						{count}
					</span>
				</span>
			}
		>
			<IfSettings block={block} />
		</BlockSettings.TabHead>
	);
}

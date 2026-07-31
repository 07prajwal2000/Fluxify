import { ConditionsBuilder, type Condition } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { BlockSettings } from "../BlockSettings";
import { useCanvasChanges } from "../../changes/ChangesContext";
import type { BlockNode } from "../../types";

function conditions(block: BlockNode): Condition[] {
	return Array.isArray(block.data.conditions)
		? (block.data.conditions as Condition[])
		: [];
}

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
			conditions={conditions(block)}
			onChange={(next) => updateNodeData(block.id, { conditions: next })}
		/>
	);
}

export function ifSettings(block: BlockNode) {
	const count = conditions(block).length;
	return (
		<BlockSettings.TabHead
			name="Edit Conditions"
			title={
				<span className="inline-flex items-center gap-1.5">
					Edit Conditions
					<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--background-secondary,#18181b)] text-[var(--muted-foreground,oklch(0.7_0_0))] border border-[var(--border,#27272a)] leading-none">
						{count}
					</span>
				</span>
			}
		>
			<IfSettings block={block} />
		</BlockSettings.TabHead>
	);
}

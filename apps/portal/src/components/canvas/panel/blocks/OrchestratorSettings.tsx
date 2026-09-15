import { TbGitBranch } from "react-icons/tb";
import { ReorderableList } from "@fluxify/components";
import { BlockSettings } from "../BlockSettings";
import { BlockSelectField } from "../fields";
import { useCanvasChanges } from "../../changes/ChangesContext";
import type { BlockNode } from "../../types";
import { FanOutEmptyState, useFanOutBranches } from "./fanOutBranches";

const ON_ERROR_OPTIONS = [
	{ value: "throw", label: "Stop and run the error handler" },
	{ value: "settle", label: "Finish every branch" },
];

/** The branches wired to the orchestrate handle, in output order. */
export function OrchestratorBranches({ block }: { block: BlockNode }) {
	const { enabled: editable } = useCanvasChanges();
	const { branches, names, move, remove, highlightProps } = useFanOutBranches(
		block,
		"orchestrate",
	);

	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium text-foreground">Branch order</span>
			{branches.length === 0 ? (
				<FanOutEmptyState
					title="No branches connected"
					icon={<TbGitBranch className="h-4.5 w-4.5" />}
				>
					Connect blocks to the <strong className="font-medium text-foreground">Branches</strong> handle on top of this block. Each connected chain runs at the same time.
				</FanOutEmptyState>
			) : (
				<>
					<ReorderableList
						items={branches}
						getKey={(branch) => branch.edgeId}
						getItemLabel={(branch) => names.get(branch.target) ?? branch.target}
						isEditable={editable}
						showIndex
						showMoveButtons
						onMove={move}
						onRemove={(branch) => remove(branch)}
						removeButtonAriaLabel="Disconnect branch"
						{...highlightProps}
					/>
					<span className="text-xs text-muted">
						The next block gets an array: index 0 is the first branch's output.
					</span>
				</>
			)}
		</div>
	);
}

export function orchestratorSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="general" name="General">
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="onError"
				label="When a branch fails"
				options={ON_ERROR_OPTIONS}
				hint="Finish every branch: a failed branch's slot holds its error message instead of an output."
			/>
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="branches" name="Branches">
			<OrchestratorBranches block={block} />
		</BlockSettings.TabHead>,
	];
}

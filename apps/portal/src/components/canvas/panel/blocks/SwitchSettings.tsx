import { useReactFlow } from "@xyflow/react";
import { TbArrowsSplit2 } from "react-icons/tb";
import {
	JsTextField,
	ReorderableList,
	isJsExpression,
	readExpression,
} from "@fluxify/components";
import { BlockSettings } from "../BlockSettings";
import { BlockCheckboxField } from "../fields";
import { useCanvasChanges } from "../../changes/ChangesContext";
import type { BlockNode } from "../../types";
import { FanOutEmptyState, useFanOutBranches } from "./fanOutBranches";
import { JsRunnerSettings } from "./JsRunnerSettings";

type Branch = ReturnType<typeof useFanOutBranches>["branches"][number];

/**
 * The cases wired to the 'case' handle, in the order they are checked. Each
 * case's condition (or match value, when switching on a value) is stored by
 * target block id, so it follows its block when the rows are reordered.
 */
export function SwitchCases({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const { branches, names, move, remove, highlightProps } = useFanOutBranches(block, "case");
	const useValue = block.data.useValue === true;
	// conditions and match values live apart, so flipping the toggle loses neither
	const field = useValue ? "matches" : "conditions";
	const entries = (block.data[field] as Record<string, string> | undefined) ?? {};

	const setEntry = (target: string, text: string) =>
		updateNodeData(block.id, { [field]: { ...entries, [target]: text } });

	const removeCase = (branch: Branch) => {
		// another case wired to the same block still needs its entries
		const shared = branches.some((b) => b.edgeId !== branch.edgeId && b.target === branch.target);
		if (shared) return remove(branch);
		const drop = (key: string) => {
			const { [branch.target]: _dropped, ...rest } =
				(block.data[key] as Record<string, string> | undefined) ?? {};
			return rest;
		};
		remove(branch, { conditions: drop("conditions"), matches: drop("matches") });
	};

	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium text-foreground">Cases</span>
			{branches.length === 0 ? (
				<FanOutEmptyState
					title="No cases connected"
					icon={<TbArrowsSplit2 className="h-4.5 w-4.5" />}
				>
					Connect blocks to the <strong className="font-medium text-foreground">Cases</strong> handle on the right of this block. Each connection becomes a case.
				</FanOutEmptyState>
			) : (
				<>
					<ReorderableList
						items={branches}
						getKey={(branch) => branch.edgeId}
						isEditable={editable}
						showIndex
						showMoveButtons
						onMove={move}
						onRemove={removeCase}
						removeButtonAriaLabel="Disconnect case"
						{...highlightProps}
						renderItemContent={(branch) => {
							const raw = entries[branch.target] ?? "";
							const blank = !(isJsExpression(raw) ? readExpression(raw) : raw).trim();
							return (
								<div className="flex flex-col gap-1 py-1 whitespace-normal">
									<span className="truncate text-xs font-medium text-foreground">
										{names.get(branch.target) ?? branch.target}
									</span>
									{/* stored exactly as the field gives it: plain text, or js: code */}
									<JsTextField
										fullWidth
										isDisabled={!editable}
										placeholder={useValue ? "paid" : "true"}
										value={raw}
										onChange={(text) => setEntry(branch.target, text)}
									/>
									{blank && (
										<span className="text-xs text-muted">
											{useValue ? "No value" : "No condition"}: this case never runs.
										</span>
									)}
								</div>
							);
						}}
					/>
					<span className="text-xs text-muted">
						{useValue
							? "Checked top to bottom. The first case whose value equals the value script's result runs; if none do, the flow stops here."
							: "Checked top to bottom. The first condition that returns a truthy value runs its case; if none do, the flow stops here."}
					</span>
				</>
			)}
		</div>
	);
}

export function switchSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="general" name="General">
			<BlockCheckboxField
				blockId={block.id}
				data={block.data}
				name="useValue"
				label="Switch on a value"
				hint="Run one script, then give each case the value it matches. Plain text compares as text; use JS for numbers and other types."
			/>
			{block.data.useValue === true && (
				<JsRunnerSettings block={block} field="value" label="Value script" />
			)}
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="cases" name="Cases">
			<SwitchCases block={block} />
		</BlockSettings.TabHead>,
	];
}

import { isJsExpression, JsTextField, ReorderableList, readExpression } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { TbArrowsSplit2, TbInfoCircle } from "react-icons/tb";
import { useCanvasChanges } from "../../changes/ChangesContext";
import type { BlockNode } from "../../types";
import { BlockSettings } from "../BlockSettings";
import { BlockCheckboxField } from "../fields";
import { FanOutEmptyState, useFanOutBranches } from "./fanOutBranches";
import { JsRunnerSettings } from "./JsRunnerSettings";

type Branch = ReturnType<typeof useFanOutBranches>["branches"][number];
/** the last row of the list: the default case, or an empty slot to drop one into */
type Row = { branch?: Branch; isDefault?: true };

/**
 * The cases wired to the 'case' handle, in the order they are checked. Each
 * case's condition (or match value, when switching on a value) is stored by
 * target block id, so it follows its block when the rows are reordered. The
 * last row is the default slot: moving a case into it makes that case run
 * only when no case above matches.
 */
export function SwitchCases({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const { branches, names, remove, highlightProps } = useFanOutBranches(block, "case");
	const useValue = block.data.useValue === true;
	// conditions and match values live apart, so flipping the toggle loses neither
	const field = useValue ? "matches" : "conditions";
	const entries = (block.data[field] as Record<string, string> | undefined) ?? {};
	const defaultTarget = (block.data.defaultCase as string | undefined) ?? "";
	const fallback = branches.find((b) => b.target === defaultTarget);
	const cases = branches.filter((b) => b.target !== fallback?.target);
	const rows: Row[] = [
		...cases.map((branch) => ({ branch })),
		{ branch: fallback, isDefault: true },
	];

	const setEntry = (target: string, text: string) =>
		updateNodeData(block.id, { [field]: { ...entries, [target]: text } });

	const move = (from: number, to: number) => {
		const ids = cases.map((b) => b.target);
		const slot = cases.length;
		if (from === slot) {
			// the default leaves its slot and becomes a normal case again
			if (!fallback) return;
			ids.splice(to, 0, fallback.target);
			return updateNodeData(block.id, { order: ids, defaultCase: "" });
		}
		const [moved] = ids.splice(from, 1);
		if (to === slot) {
			// a case replaced as default goes back to the end of the list
			if (fallback) ids.push(fallback.target);
			return updateNodeData(block.id, { order: [...ids, moved], defaultCase: moved });
		}
		ids.splice(to, 0, moved);
		updateNodeData(block.id, { order: fallback ? [...ids, fallback.target] : ids });
	};

	const removeCase = (branch: Branch) => {
		// another case wired to the same block still needs its entries
		const shared = branches.some((b) => b.edgeId !== branch.edgeId && b.target === branch.target);
		if (shared) return remove(branch);
		const drop = (key: string) => {
			const { [branch.target]: _dropped, ...rest } =
				(block.data[key] as Record<string, string> | undefined) ?? {};
			return rest;
		};
		remove(branch, {
			conditions: drop("conditions"),
			matches: drop("matches"),
			...(branch.target === defaultTarget && { defaultCase: "" }),
		});
	};

	const name = (branch: Branch) => (
		<span className="truncate text-xs font-medium text-foreground">
			{names.get(branch.target) ?? branch.target}
		</span>
	);

	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium text-foreground">Cases</span>
			<div className="flex items-start gap-2.5 rounded-lg border border-border bg-background-secondary p-3 text-xs leading-relaxed text-muted">
				<TbInfoCircle className="mt-0.5 size-4 shrink-0 text-accent" />
				<div>
					Plain text is compared with strict equality (===) to{" "}
					{useValue ? "the value script's result" : "the Switch's input"}, so the type matters.{" "}
					<code>404</code>, <code>true</code> and <code>false</code> become a number or boolean;
					anything else is text. Only literals are matched: <code>input.status</code> is compared as
					that text, not read. Turn on JS for anything else.
				</div>
			</div>
			{branches.length === 0 ? (
				<FanOutEmptyState
					title="No cases connected"
					icon={<TbArrowsSplit2 className="h-4.5 w-4.5" />}
				>
					Connect blocks to the <strong className="font-medium text-foreground">Cases</strong>{" "}
					handle on the right of this block. Each connection becomes a case.
				</FanOutEmptyState>
			) : (
				<>
					<ReorderableList
						items={rows}
						getKey={(row) => (row.isDefault ? "__default__" : row.branch!.edgeId)}
						isEditable={editable}
						showIndex
						showMoveButtons
						onMove={move}
						onRemove={(row) => row.branch && removeCase(row.branch)}
						removeButtonAriaLabel="Disconnect case"
						isItemLocked={(row) => !row.branch}
						isItemPinned={(row) => row.isDefault === true}
						placeholderText="Drop here (the last slot is the default)"
						onItemMouseEnter={(row, el) =>
							row.branch && highlightProps.onItemMouseEnter(row.branch, el)
						}
						onItemMouseLeave={highlightProps.onItemMouseLeave}
						onItemFocus={(row, el) => row.branch && highlightProps.onItemFocus(row.branch, el)}
						onItemBlur={highlightProps.onItemBlur}
						onDragStart={(row, index, el) =>
							row.branch && highlightProps.onDragStart(row.branch, index, el)
						}
						onDragEnd={highlightProps.onDragEnd}
						renderItemContent={(row) => {
							if (row.isDefault) {
								return (
									<div className="flex flex-col gap-1 py-1 whitespace-normal">
										<span className="text-xs font-semibold uppercase tracking-wide text-muted">
											Default
										</span>
										{row.branch ? (
											<>
												{name(row.branch)}
												<span className="text-xs text-muted">Runs when no case above matches.</span>
											</>
										) : (
											<span className="text-xs text-warning">
												No default case: if no case matches, the flow stops here and returns the
												Switch's input. Drag a case here, or move the last case down, to make it the
												default.
											</span>
										)}
									</div>
								);
							}
							const branch = row.branch!;
							const raw = entries[branch.target] ?? "";
							const blank = !(isJsExpression(raw) ? readExpression(raw) : raw).trim();
							return (
								<div className="flex flex-col gap-1 py-1 whitespace-normal">
									{name(branch)}
									{/* stored exactly as the field gives it: plain text, or js: code */}
									<JsTextField
										fullWidth
										isDisabled={!editable}
										placeholder="paid"
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
							? "Checked top to bottom. The first case whose value equals the value script's result runs; if none do, the default case runs."
							: "Checked top to bottom. Plain text runs its case when the input === it (numbers and true/false keep their type); JS runs it when it returns a truthy value. If none match, the default case runs."}
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
				hint="Run one script, then give each case the value it matches. Plain numbers and true/false keep their type; other plain text is compared as text."
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

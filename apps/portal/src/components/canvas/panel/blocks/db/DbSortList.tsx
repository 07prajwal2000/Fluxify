import { Button, Description, JsTextField, Label, ReorderableList } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { TbSortAscending, TbSortDescending } from "react-icons/tb";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import type { BlockNode } from "../../../types";

export type SortEntry = { attribute: string; direction: "asc" | "desc" };

/** The stored sort as a list. Graphs saved before it was a list hold one object. */
export function parseSort(raw: unknown): SortEntry[] {
	const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
	return list.map((entry) => {
		const e = (entry ?? {}) as Partial<SortEntry>;
		return {
			attribute: typeof e.attribute === "string" ? e.attribute : "",
			direction: e.direction === "desc" ? "desc" : "asc",
		};
	});
}

/**
 * ORDER BY as a draggable list: the top entry sorts first, each next one
 * breaks the ties of those above it.
 */
export function DbSortList({
	block,
	columnSuggestions,
	description,
}: {
	block: BlockNode;
	columnSuggestions?: string[];
	description: string;
}) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const sort = parseSort(block.data.sort);
	const save = (next: SortEntry[]) => updateNodeData(block.id, { sort: next });
	const update = (index: number, patch: Partial<SortEntry>) =>
		save(sort.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));

	return (
		<div className="flex flex-col gap-2 w-full">
			<div className="flex flex-col gap-0.5">
				<Label>Sort</Label>
				<Description>{description}</Description>
			</div>
			<ReorderableList
				items={sort}
				getKey={(_, index) => index}
				isEditable={editable}
				showIndex
				showMoveButtons
				onReorder={save}
				onRemove={(_, index) => save(sort.filter((__, i) => i !== index))}
				removeButtonAriaLabel="Remove sort"
				emptyMessage={
					<span className="text-xs text-muted">No sort: rows come back in primary key order.</span>
				}
				renderItemContent={(entry, { index }) => (
					<div className="flex items-center gap-2 w-full py-1">
						<div className="flex-1 min-w-0">
							<JsTextField
								fullWidth
								isDisabled={!editable}
								placeholder="created_at"
								value={entry.attribute}
								suggestions={columnSuggestions}
								onChange={(attribute) => update(index, { attribute })}
							/>
						</div>
						<Button
							aria-label={`Sort ${index + 1}: ${entry.direction === "asc" ? "ascending" : "descending"}, click to flip`}
							isDisabled={!editable}
							size="sm"
							variant="secondary"
							onPress={() =>
								update(index, { direction: entry.direction === "asc" ? "desc" : "asc" })
							}
						>
							{entry.direction === "asc" ? (
								<TbSortAscending className="size-4" />
							) : (
								<TbSortDescending className="size-4" />
							)}
							{entry.direction === "asc" ? "Asc" : "Desc"}
						</Button>
					</div>
				)}
			/>
			{editable && (
				<Button
					variant="outline"
					onPress={() => save([...sort, { attribute: "", direction: "asc" }])}
				>
					Add sort
				</Button>
			)}
		</div>
	);
}

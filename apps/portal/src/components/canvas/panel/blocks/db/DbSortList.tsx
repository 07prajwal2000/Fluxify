import { Button, FieldInfoButton, JsTextField, Label, ReorderableList } from "@fluxify/components";
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
			<div className="flex items-center gap-1">
				<Label>Sort</Label>
				<FieldInfoButton label="Sort" info={{ content: description }} />
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

/**
 * Cursor paging's tiebreaker columns, in order: after the sort, rows are told
 * apart by these. Empty means the primary key.
 */
export function DbTiebreakerList({
	block,
	columnSuggestions,
}: {
	block: BlockNode;
	columnSuggestions?: string[];
}) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const keys = Array.isArray(block.data.keys)
		? (block.data.keys as unknown[]).map((k) => (typeof k === "string" ? k : ""))
		: [];
	const save = (next: string[]) => updateNodeData(block.id, { keys: next });

	return (
		<div className="flex flex-col gap-2 w-full">
			<div className="flex items-center gap-1">
				<Label>Tiebreaker columns</Label>
				<FieldInfoButton
					label="Tiebreaker columns"
					info={{
						content:
							"Columns that are unique together, used after the sort so rows that tie are never skipped between pages. Leave empty to use the primary key (_id on MongoDB); a table without one, such as a view, needs them.",
					}}
				/>
			</div>
			<ReorderableList
				items={keys}
				getKey={(_, index) => index}
				isEditable={editable}
				showIndex
				showMoveButtons
				onReorder={save}
				onRemove={(_, index) => save(keys.filter((__, i) => i !== index))}
				removeButtonAriaLabel="Remove tiebreaker"
				emptyMessage={
					<span className="text-xs text-muted">No tiebreaker: the primary key is used.</span>
				}
				renderItemContent={(key, { index }) => (
					<div className="w-full py-1">
						<JsTextField
							fullWidth
							isDisabled={!editable}
							placeholder="id"
							value={key}
							suggestions={columnSuggestions}
							onChange={(value) => save(keys.map((k, i) => (i === index ? value : k)))}
						/>
					</div>
				)}
			/>
			{editable && (
				<Button variant="outline" onPress={() => save([...keys, ""])}>
					Add tiebreaker
				</Button>
			)}
		</div>
	);
}

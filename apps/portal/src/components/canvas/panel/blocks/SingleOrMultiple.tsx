import { Button, JsTextField, ListBox, ReorderableList, Select } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { type ReactNode, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useCanvasChanges } from "../../changes/ChangesContext";
import type { BlockNode } from "../../types";
import type { SelectOption } from "../fields";

/** One field of a row; the same field the block shows in Single mode. */
export type RowField = {
	name: string;
	label: string;
	placeholder?: string;
	/** a select instead of a text field */
	options?: SelectOption[];
	disableJs?: boolean;
	/** value of a new row; the first option, or empty */
	initial?: string;
	/** a number typed in is stored as a number, as the Single field does */
	numeric?: boolean;
};

type Row = Record<string, unknown>;

const toText = (value: unknown) =>
	typeof value === "string"
		? value
		: value && typeof value === "object"
			? JSON.stringify(value)
			: value == null
				? ""
				: String(value);

const toNumberIfNumeric = (next: string): unknown => {
	const trimmed = next.trim();
	return trimmed !== "" && !trimmed.startsWith("js:") && !Number.isNaN(Number(trimmed))
		? Number(trimmed)
		: next;
};

/**
 * Single / Multiple mode for a Set or Get block. Single renders `single`, the
 * block's own fields, unchanged. Multiple stores the same fields per row in
 * `items`, run top to bottom; the block then outputs an array, one per row.
 */
export function SingleOrMultiple({
	block,
	fields,
	single,
	addLabel,
}: {
	block: BlockNode;
	fields: RowField[];
	single: ReactNode;
	addLabel: string;
}) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const [confirmSingle, setConfirmSingle] = useState(false);
	const multiple = block.data.mode === "multiple";
	const items: Row[] = Array.isArray(block.data.items) ? (block.data.items as Row[]) : [];

	const emptyRow = (): Row =>
		Object.fromEntries(fields.map((f) => [f.name, f.initial ?? f.options?.[0].value ?? ""]));
	const save = (next: Row[]) => updateNodeData(block.id, { items: next });
	const update = (index: number, patch: Row) =>
		save(items.map((row, i) => (i === index ? { ...row, ...patch } : row)));

	// the current values become the first row, and the first row comes back
	const toMultiple = () => {
		const first = Object.fromEntries(
			fields.map((f) => [f.name, block.data[f.name] ?? emptyRow()[f.name]]),
		);
		updateNodeData(block.id, { mode: "multiple", items: [first] });
	};
	const toSingle = () => {
		setConfirmSingle(false);
		updateNodeData(block.id, { mode: "single", ...(items[0] ?? emptyRow()) });
	};

	return (
		<div className="flex flex-col gap-4 w-full">
			<div className="flex gap-1" role="group" aria-label="Mode">
				<Button
					size="sm"
					variant={multiple ? "ghost" : "secondary"}
					isDisabled={!editable}
					aria-pressed={!multiple}
					onPress={() => multiple && (items.length > 1 ? setConfirmSingle(true) : toSingle())}
				>
					Single
				</Button>
				<Button
					size="sm"
					variant={multiple ? "secondary" : "ghost"}
					isDisabled={!editable}
					aria-pressed={multiple}
					onPress={() => !multiple && toMultiple()}
				>
					Multiple
				</Button>
			</div>

			{!multiple && single}

			{multiple && (
				<div className="flex flex-col gap-2 w-full">
					<span className="text-xs text-muted">
						Rows run top to bottom. The output is an array with one value per row.
					</span>
					<ReorderableList
						items={items}
						getKey={(_, index) => index}
						isEditable={editable}
						showIndex
						showMoveButtons
						onReorder={save}
						onRemove={
							items.length > 1
								? (_, index) => save(items.filter((__, i) => i !== index))
								: undefined
						}
						removeButtonAriaLabel="Remove row"
						renderItemContent={(row, { index }) => (
							<div className="flex items-center gap-2 w-full py-1">
								{fields.map((field) => (
									<div key={field.name} className="flex-1 min-w-0">
										{field.options ? (
											<Select
												fullWidth
												variant="secondary"
												aria-label={`${field.label} ${index + 1}`}
												isDisabled={!editable}
												value={toText(row[field.name]) || null}
												onChange={(next) => update(index, { [field.name]: String(next) })}
											>
												<Select.Trigger>
													<Select.Value />
													<Select.Indicator />
												</Select.Trigger>
												<Select.Popover>
													<ListBox>
														{field.options.map((option) => (
															<ListBox.Item
																key={option.value}
																id={option.value}
																textValue={option.label}
															>
																{option.label}
																<ListBox.ItemIndicator />
															</ListBox.Item>
														))}
													</ListBox>
												</Select.Popover>
											</Select>
										) : (
											<JsTextField
												fullWidth
												variant="secondary"
												aria-label={`${field.label} ${index + 1}`}
												isDisabled={!editable}
												disableJs={field.disableJs}
												placeholder={field.placeholder ?? field.label}
												value={toText(row[field.name])}
												onChange={(next) =>
													update(index, {
														[field.name]: field.numeric ? toNumberIfNumeric(next) : next,
													})
												}
											/>
										)}
									</div>
								))}
							</div>
						)}
					/>
					{editable && (
						<Button variant="outline" onPress={() => save([...items, emptyRow()])}>
							{addLabel}
						</Button>
					)}
				</div>
			)}

			<ConfirmDialog
				open={confirmSingle}
				onOpenChange={setConfirmSingle}
				title="Switch to Single?"
				confirmText="Keep first row"
				danger
				onConfirm={toSingle}
			>
				Single mode keeps only the first row. The other {items.length - 1} row
				{items.length > 2 ? "s are" : " is"} removed.
			</ConfirmDialog>
		</div>
	);
}

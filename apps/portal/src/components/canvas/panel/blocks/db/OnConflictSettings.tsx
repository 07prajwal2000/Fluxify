import { ArrayEditor, Checkbox, Description, Label, ListBox, Select } from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import { useDbMetadata } from "@/query/findResourceQuery";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import type { BlockNode } from "../../../types";
import { readDbBinding } from "./conditions";

type OnConflict = { target: string[]; action: "update" | "ignore"; update?: string[] };

/** "On conflict" section of the insert blocks: upsert or skip rows whose unique key exists */
export function OnConflictSettings({ block, bulk }: { block: BlockNode; bulk?: boolean }) {
	const params = useParams({ strict: false }) as { projectId?: string };
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const { connectionId, tableName } = readDbBinding(block);
	const { getColumnsForTable } = useDbMetadata(params?.projectId ?? "", connectionId);
	const columns = getColumnsForTable(tableName);

	const onConflict = block.data.onConflict as OnConflict | undefined;
	const set = (next: OnConflict | undefined) => updateNodeData(block.id, { onConflict: next });

	return (
		<div className="flex flex-col gap-4 w-full">
			<Checkbox
				checked={!!onConflict}
				isDisabled={!editable}
				label="On conflict"
				description="When a row with the same unique key already exists, update it or skip it instead of failing."
				onChange={(on) => set(on ? { target: [], action: "update" } : undefined)}
			/>
			{onConflict && (
				<>
					<ArrayEditor
						label="Match on"
						description="The unique column(s) that identify a row. PostgreSQL needs a unique index on exactly these. MySQL matches any unique key and uses these to read the rows back."
						placeholder="e.g. email"
						addButtonLabel="Add Column"
						disableJs={true}
						isDisabled={!editable}
						values={onConflict.target}
						suggestions={columns}
						onChange={(target) => set({ ...onConflict, target })}
					/>
					<Select
						fullWidth
						variant="secondary"
						isDisabled={!editable}
						value={onConflict.action}
						onChange={(action) => set({ ...onConflict, action: action as OnConflict["action"] })}
					>
						<Label>If it exists</Label>
						<Select.Trigger>
							<Select.Value />
							<Select.Indicator />
						</Select.Trigger>
						<Description>
							Skipped rows are left out of the result. On MySQL, skipping reads the existing keys
							first (one extra query).
							{bulk &&
								" On PostgreSQL, two rows with the same key in one bulk update fail the insert."}
						</Description>
						<Select.Popover>
							<ListBox>
								<ListBox.Item id="update" textValue="Update it">
									Update it
									<ListBox.ItemIndicator />
								</ListBox.Item>
								<ListBox.Item id="ignore" textValue="Skip it">
									Skip it
									<ListBox.ItemIndicator />
								</ListBox.Item>
							</ListBox>
						</Select.Popover>
					</Select>
					{onConflict.action === "update" && (
						<ArrayEditor
							label="Columns to update"
							description="Leave empty to update every inserted column except the ones matched on."
							placeholder="e.g. name"
							addButtonLabel="Add Column"
							disableJs={true}
							isDisabled={!editable}
							values={onConflict.update ?? []}
							suggestions={columns}
							onChange={(update) =>
								set({ ...onConflict, update: update.length ? update : undefined })
							}
						/>
					)}
				</>
			)}
		</div>
	);
}

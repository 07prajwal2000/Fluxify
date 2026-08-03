import { Button, Description, JsTextField, Label } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { TbMinus, TbPlus } from "react-icons/tb";
import { useCanvasChanges } from "../../changes/ChangesContext";
import { BlockSettings } from "../BlockSettings";
import { BlockCheckboxField } from "../fields";
import type { BlockNode } from "../../types";

/** Foreach Loop General tab settings: Use Param toggle. */
export function ForeachLoopGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4">
			<BlockCheckboxField
				blockId={block.id}
				data={block.data}
				name="useParam"
				label="Use Param"
				description="Use input parameter as the datasource?"
			/>
		</div>
	);
}

/** Foreach Loop Data tab settings: Array items editor. */
export function ForeachLoopDataSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const values = Array.isArray(block.data.values)
		? (block.data.values as any[])
		: [];

	const handleValueChange = (index: number, val: string) => {
		const next = values.map((item, i) => (i === index ? val : item));
		updateNodeData(block.id, { values: next });
	};

	const handleAdd = () => {
		updateNodeData(block.id, { values: [...values, ""] });
	};

	const handleRemove = (index: number) => {
		updateNodeData(block.id, { values: values.filter((_, i) => i !== index) });
	};

	return (
		<div className="flex flex-col gap-3 w-full">
			<div className="flex flex-col gap-1">
				<Label className="text-sm font-medium">Array Items</Label>
				<Description className="text-xs text-muted">
					Items to iterate over in each loop step.
				</Description>
			</div>

			<div className="flex flex-col gap-2.5 w-full">
				{values.map((item, index) => (
					<div key={index} className="flex items-center gap-2 w-full">
						<div className="flex-1">
							<JsTextField
								fullWidth
								variant="secondary"
								isDisabled={!editable}
								placeholder="Enter value or js: expression"
								value={
									typeof item === "string"
										? item
										: item != null
											? String(item)
											: ""
								}
								onChange={(next) => handleValueChange(index, next)}
							/>
						</div>
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							isDisabled={!editable}
							onPress={() => handleRemove(index)}
							aria-label="Remove item"
						>
							<TbMinus className="size-4 text-danger" />
						</Button>
					</div>
				))}
				{values.length === 0 && (
					<div className="text-xs text-muted py-2 text-center border border-dashed border-[var(--border,#27272a)] rounded-md">
						No items in array
					</div>
				)}
			</div>

			<div>
				<Button
					isDisabled={!editable}
					size="sm"
					variant="secondary"
					className="mt-1"
					onPress={handleAdd}
				>
					<TbPlus className="size-4 mr-1" /> Add Item
				</Button>
			</div>
		</div>
	);
}

export function foreachLoopSettings(block: BlockNode) {
	const useParam = Boolean(block.data.useParam);

	const tabs = [
		<BlockSettings.TabHead key="general" name="General">
			<ForeachLoopGeneralSettings block={block} />
		</BlockSettings.TabHead>,
	];

	if (!useParam) {
		tabs.push(
			<BlockSettings.TabHead key="data" name="Data">
				<ForeachLoopDataSettings block={block} />
			</BlockSettings.TabHead>,
		);
	}

	return tabs;
}

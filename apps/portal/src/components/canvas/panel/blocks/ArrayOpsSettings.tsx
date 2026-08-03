import { ConditionsBuilder, type Condition } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { useCanvasChanges } from "../../changes/ChangesContext";
import { BlockSettings } from "../BlockSettings";
import {
	BlockCheckboxField,
	BlockJsTextField,
	BlockSelectField,
	BlockTextField,
} from "../fields";
import type { BlockNode } from "../../types";

/** Array Operations General tab settings: Datasource and Use Param. */
export function ArrayOpsGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4">
			<BlockTextField
				blockId={block.id}
				data={block.data}
				name="datasource"
				label="Datasource"
				placeholder="Type or enter variable name"
				hint="Choose a variable which contains the target array on which operation will be performed"
			/>
			<BlockCheckboxField
				blockId={block.id}
				data={block.data}
				name="useParamAsInput"
				label="Use Param"
				description="Use input parameter as the datasource?"
			/>
		</div>
	);
}

/** Array Operations Operation tab settings: Operation dropdown and optional Value field. */
export function ArrayOpsOperationSettings({ block }: { block: BlockNode }) {
	const operation = String(block.data.operation ?? "");
	const useParamAsInput = Boolean(block.data.useParamAsInput);
	const showValueField =
		!useParamAsInput && (operation === "push" || operation === "unshift");

	return (
		<div className="flex flex-col gap-4">
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="operation"
				label="Operation"
				placeholder="Select an operation"
				hint="Select an operation to perform on the array"
				options={[
					{ value: "push", label: "Push" },
					{ value: "pop", label: "Pop" },
					{ value: "shift", label: "Shift" },
					{ value: "unshift", label: "Unshift" },
					{ value: "filter", label: "Filter" },
				]}
			/>
			{showValueField && (
				<BlockJsTextField
					blockId={block.id}
					data={block.data}
					name="value"
					label="Value"
					placeholder="Value or js: expression"
					hint="Operation is performed on the datasource with this value (can be JS expression)"
				/>
			)}
		</div>
	);
}

/** Array Operations Conditions tab settings: ConditionsBuilder. */
export function ArrayOpsConditionsSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const filterConditions = Array.isArray(block.data.filterConditions)
		? (block.data.filterConditions as Condition[])
		: [];

	return (
		<ConditionsBuilder
			collapsible={false}
			label="Filter Conditions"
			description="Conditions evaluated on array elements."
			isDisabled={!editable}
			conditions={filterConditions}
			onChange={(next) => updateNodeData(block.id, { filterConditions: next })}
		/>
	);
}

export function arrayOpsSettings(block: BlockNode) {
	const operation = String(block.data.operation ?? "");
	const filterConditions = Array.isArray(block.data.filterConditions)
		? (block.data.filterConditions as Condition[])
		: [];
	const count = filterConditions.length;

	const tabs = [
		<BlockSettings.TabHead key="general" name="General">
			<ArrayOpsGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="operation" name="Operation">
			<ArrayOpsOperationSettings block={block} />
		</BlockSettings.TabHead>,
	];

	if (operation === "filter") {
		tabs.push(
			<BlockSettings.TabHead
				key="conditions"
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
				<ArrayOpsConditionsSettings block={block} />
			</BlockSettings.TabHead>,
		);
	}

	return tabs;
}

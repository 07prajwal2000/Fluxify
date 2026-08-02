import {
	ConditionsBuilder,
	type Condition,
} from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import { BlockSettings } from "../../BlockSettings";
import {
	BlockArrayEditorField,
	BlockIntegrationField,
	BlockJsTextField,
	BlockJoinsEditorField,
} from "../../fields";
import type { BlockNode } from "../../../types";

type RawWhereCondition = {
	attribute?: string;
	lhs?: string;
	value?: string | number;
	rhs?: string | number;
	operator?: string;
	chain?: "and" | "or";
};

function parseConditions(block: BlockNode): Condition[] {
	const raw = Array.isArray(block.data.conditions)
		? (block.data.conditions as RawWhereCondition[])
		: [];

	return raw.map((c) => ({
		chain: c.chain || "and",
		lhs: String(c.attribute ?? c.lhs ?? ""),
		rhs: String(c.value ?? c.rhs ?? ""),
		operator: (c.operator as any) || "equal_to",
	}));
}

function parseColumns(block: BlockNode): string[] {
	if (Array.isArray(block.data.columns)) {
		return block.data.columns as string[];
	}
	return ["*"];
}

function parseJoins(block: BlockNode): unknown[] {
	if (Array.isArray(block.data.joins)) {
		return block.data.joins;
	}
	return [];
}

/** General tab: Connection selection and Table Name */
export function GetSingleDbGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockIntegrationField
				blockId={block.id}
				data={block.data}
				name="connection"
				group="database"
				label="Choose Database Connection"
				description="Select the database connection to use for this block"
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="tableName"
				label="Table Name"
				placeholder="users"
				hint="Enter the table name to query or a JS expression (js:...)."
			/>
		</div>
	);
}

/** Columns tab: Selected columns array editor (plain strings, no JS expressions) */
export function GetSingleDbColumnsSettings({ block }: { block: BlockNode }) {
	const columns = parseColumns(block);
	const dataWithDefaults = {
		...block.data,
		columns: block.data.columns === undefined ? ["*"] : columns,
	};

	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockArrayEditorField
				blockId={block.id}
				data={dataWithDefaults}
				name="columns"
				label="Columns"
				description="Columns to select (e.g. id, users.name AS name, *)."
				placeholder="e.g. * or id"
				addButtonLabel="Add Column"
				disableJs={true}
			/>
		</div>
	);
}

/** Joins tab: Table joins configuration */
export function GetSingleDbJoinsSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockJoinsEditorField
				blockId={block.id}
				data={block.data}
				name="joins"
				label="Table Joins"
				description="Configure relational table joins for this query."
				emptyMessage="No table joins configured."
			/>
		</div>
	);
}

/** Conditions tab: WHERE conditions builder */
export function GetSingleDbConditionsSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const conditions = parseConditions(block);

	return (
		<div className="flex flex-col gap-4 w-full">
			<ConditionsBuilder
				collapsible={false}
				disableJsConditions={true}
				ignoreOperators={["is_empty", "is_not_empty"]}
				label="Conditions"
				description="The conditions used to match the single record from the database."
				isDisabled={!editable}
				conditions={conditions}
				onChange={(nextConditions) => {
					const serialized = nextConditions.map((c) => ({
						attribute: c.lhs,
						value: c.rhs,
						operator: c.operator,
						chain: c.chain,
					}));
					updateNodeData(block.id, { conditions: serialized });
				}}
			/>
		</div>
	);
}

export function getSingleDbSettings(block: BlockNode) {
	const columnsCount = parseColumns(block).length;
	const joinsCount = parseJoins(block).length;
	const conditionsCount = parseConditions(block).length;

	return [
		<BlockSettings.TabHead key="general" name="General">
			<GetSingleDbGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead
			key="columns"
			name="Columns"
			title={
				<span className="inline-flex items-center gap-1.5">
					Columns
					{columnsCount > 0 && (
						<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--background-secondary,#18181b)] text-[var(--muted-foreground,oklch(0.7_0_0))] border border-[var(--border,#27272a)] leading-none">
							{columnsCount}
						</span>
					)}
				</span>
			}
		>
			<GetSingleDbColumnsSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead
			key="joins"
			name="Joins"
			title={
				<span className="inline-flex items-center gap-1.5">
					Joins
					{joinsCount > 0 && (
						<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--background-secondary,#18181b)] text-[var(--muted-foreground,oklch(0.7_0_0))] border border-[var(--border,#27272a)] leading-none">
							{joinsCount}
						</span>
					)}
				</span>
			}
		>
			<GetSingleDbJoinsSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead
			key="conditions"
			name="Edit Conditions"
			title={
				<span className="inline-flex items-center gap-1.5">
					Edit Conditions
					{conditionsCount > 0 && (
						<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--background-secondary,#18181b)] text-[var(--muted-foreground,oklch(0.7_0_0))] border border-[var(--border,#27272a)] leading-none">
							{conditionsCount}
						</span>
					)}
				</span>
			}
		>
			<GetSingleDbConditionsSettings block={block} />
		</BlockSettings.TabHead>,
	];
}

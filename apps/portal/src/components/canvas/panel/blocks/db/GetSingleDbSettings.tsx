import { ConditionsBuilder } from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import { useMemo } from "react";
import { useDbMetadata } from "@/query/findResourceQuery";
import { BLOCK_TYPES } from "../../../blocks/blockTypes";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import type { BlockNode } from "../../../types";
import { BlockSettings } from "../../BlockSettings";
import {
	BlockArrayEditorField,
	BlockCheckboxField,
	BlockIntegrationField,
	BlockJoinsEditorField,
	BlockJsTextField,
} from "../../fields";
import { parseDbConditions, readDbBinding, serializeDbConditions } from "./conditions";
import { DbSortList } from "./DbSortList";

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
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params?.projectId ?? "";
	const { connectionId } = readDbBinding(block);
	const { tableNames } = useDbMetadata(projectId, connectionId);

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
				suggestions={tableNames}
				hint="Enter or select the table name to query, or a JS expression (js:...)."
			/>
			{/* Row Exists and Count share this tab; only a lookup cares how many matched */}
			{block.type === BLOCK_TYPES.db_getsingle && (
				<BlockCheckboxField
					blockId={block.id}
					data={block.data}
					name="strict"
					label="Strict: exactly one match"
					description="Fail the block when more than one record matches, instead of returning one of them. Use it for lookups that should be unique, like an id or email."
				/>
			)}
		</div>
	);
}

/** Columns tab: Selected columns array editor (plain strings, no JS expressions) */
export function GetSingleDbColumnsSettings({ block }: { block: BlockNode }) {
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params?.projectId ?? "";
	const { connectionId, tableName } = readDbBinding(block);
	const { getColumnsForTable, allColumns } = useDbMetadata(projectId, connectionId);
	const tableColumns = getColumnsForTable(tableName);
	const columnSuggestions = useMemo(() => {
		const cols = tableColumns.length > 0 ? tableColumns : allColumns;
		const distinct = cols.filter((c) => c !== "*");
		return ["*", ...distinct];
	}, [tableColumns, allColumns]);

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
				suggestions={columnSuggestions}
			/>
		</div>
	);
}

/** Joins tab: Table joins configuration */
export function GetSingleDbJoinsSettings({ block }: { block: BlockNode }) {
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params?.projectId ?? "";
	const { connectionId, tableName } = readDbBinding(block);
	const { tableNames, getColumnsForTable, allColumns, variant } = useDbMetadata(
		projectId,
		connectionId,
	);
	const tableColumns = getColumnsForTable(tableName);
	const columnSuggestions = tableColumns.length > 0 ? tableColumns : allColumns;

	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockJoinsEditorField
				blockId={block.id}
				data={block.data}
				name="joins"
				label="Table Joins"
				description={
					variant === "MongoDB"
						? "MongoDB ignores joins. Only the main collection is queried."
						: "Configure relational table joins for this query."
				}
				emptyMessage="No table joins configured."
				tableSuggestions={tableNames}
				columnSuggestions={columnSuggestions}
				getColumnSuggestions={getColumnsForTable}
			/>
		</div>
	);
}

/** Conditions tab: WHERE conditions builder */
export function GetSingleDbConditionsSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params?.projectId ?? "";
	const { connectionId, tableName } = readDbBinding(block);
	const { getColumnsForTable, allColumns, variant, conditionEditor } = useDbMetadata(
		projectId,
		connectionId,
	);
	const tableColumns = getColumnsForTable(tableName);
	const columnSuggestions = tableColumns.length > 0 ? tableColumns : allColumns;

	return (
		<div className="flex flex-col gap-4 w-full">
			<ConditionsBuilder
				collapsible={false}
				disableJsConditions={true}
				ignoreOperators={["is_empty", "is_not_empty"]}
				label="Conditions"
				description="The conditions used to match the single record from the database."
				isDisabled={!editable}
				conditions={parseDbConditions(block)}
				lhsSuggestions={columnSuggestions}
				rhsSuggestions={columnSuggestions}
				// MongoDB has no field-to-field comparison in this query builder
				allowColumnRefs={variant !== "MongoDB"}
				customConditionEditor={conditionEditor}
				allowGroups
				onChange={(nextConditions) => {
					updateNodeData(block.id, {
						conditions: serializeDbConditions(nextConditions),
					});
				}}
			/>
		</div>
	);
}

/** Sort tab: which row to pick when several match */
export function GetSingleDbSortSettings({ block }: { block: BlockNode }) {
	const params = useParams({ strict: false }) as { projectId?: string };
	const { connectionId, tableName } = readDbBinding(block);
	const { getColumnsForTable, allColumns } = useDbMetadata(params?.projectId ?? "", connectionId);
	const tableColumns = getColumnsForTable(tableName);
	return (
		<DbSortList
			block={block}
			columnSuggestions={tableColumns.length > 0 ? tableColumns : allColumns}
			description="Picks which row comes back when several match, e.g. created_at Desc for the newest. The top entry sorts first; drag to reorder. With no sort, any matching row may come back."
		/>
	);
}

export function getSingleDbSettings(block: BlockNode) {
	const columnsCount = parseColumns(block).length;
	const joinsCount = parseJoins(block).length;
	const conditionsCount = parseDbConditions(block).length;

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
		<BlockSettings.TabHead key="sort" name="Sort">
			<GetSingleDbSortSettings block={block} />
		</BlockSettings.TabHead>,
	];
}

/** Row Exists: only asks whether a row matches, so which one (Sort) does not matter */
export function existsDbSettings(block: BlockNode) {
	return getSingleDbSettings(block).filter((tab) => tab.key !== "sort");
}

/** Count Records: the get-single tabs minus Columns and Sort, since only the number comes back */
export function countDbSettings(block: BlockNode) {
	return getSingleDbSettings(block).filter((tab) => tab.key !== "columns" && tab.key !== "sort");
}

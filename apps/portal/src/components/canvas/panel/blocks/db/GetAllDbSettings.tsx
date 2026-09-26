import {
	ConditionsBuilder,
	Description,
	JsTextField,
	Label,
	ListBox,
	Select,
} from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import { useMemo } from "react";
import { useDbMetadata } from "@/query/findResourceQuery";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import type { BlockNode } from "../../../types";
import { BlockSettings } from "../../BlockSettings";
import {
	BlockArrayEditorField,
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
export function GetAllDbGeneralSettings({ block }: { block: BlockNode }) {
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
		</div>
	);
}

/** Pagination tab: Limit, Offset, and Sorting configuration */
export function GetAllDbPaginationSettings({ block }: { block: BlockNode }) {
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params?.projectId ?? "";
	const { connectionId, tableName } = readDbBinding(block);
	const { getColumnsForTable, allColumns } = useDbMetadata(projectId, connectionId);
	const tableColumns = getColumnsForTable(tableName);
	const columnSuggestions = tableColumns.length > 0 ? tableColumns : allColumns;
	return (
		<div className="flex flex-col gap-4 w-full">
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
				<BlockJsTextField
					blockId={block.id}
					data={block.data}
					name="limit"
					label="Limit"
					placeholder="1000"
					hint="Maximum records to return (supports js: expression)."
				/>
				<BlockJsTextField
					blockId={block.id}
					data={block.data}
					name="offset"
					label="Offset"
					placeholder="0"
					hint="Skip count for pagination (supports js: expression)."
				/>
			</div>
			<DbSortList
				block={block}
				columnSuggestions={columnSuggestions}
				description="The top entry sorts first; each next one orders rows that tie above it. Drag to reorder. The primary key is always added last, so paging never repeats or skips rows. A column set to js: that returns undefined is skipped."
			/>
		</div>
	);
}

/** Columns tab: Selected columns array editor (plain strings, no JS expressions) */
export function GetAllDbColumnsSettings({ block }: { block: BlockNode }) {
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
export function GetAllDbJoinsSettings({ block }: { block: BlockNode }) {
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
export function GetAllDbConditionsSettings({ block }: { block: BlockNode }) {
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
				description="The conditions used to match records from the database."
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

export function getAllDbSettings(block: BlockNode) {
	const columnsCount = parseColumns(block).length;
	const joinsCount = parseJoins(block).length;
	const conditionsCount = parseDbConditions(block).length;

	return [
		<BlockSettings.TabHead key="general" name="General">
			<GetAllDbGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="pagination" name="Pagination">
			<GetAllDbPaginationSettings block={block} />
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
			<GetAllDbColumnsSettings block={block} />
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
			<GetAllDbJoinsSettings block={block} />
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
			<GetAllDbConditionsSettings block={block} />
		</BlockSettings.TabHead>,
	];
}

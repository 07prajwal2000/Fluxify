import { useMemo } from "react";
import {
	ConditionsBuilder,
	type Condition,
	Description,
	JsTextField,
	Label,
	ListBox,
	Select,
} from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import { useDbMetadata } from "@/query/findResourceQuery";
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

type SortConfig = {
	attribute?: string;
	direction?: "asc" | "desc";
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

function parseSort(block: BlockNode): { attribute: string; direction: "asc" | "desc" } {
	const rawSort = block.data.sort as Partial<SortConfig> | undefined;
	return {
		attribute: typeof rawSort?.attribute === "string" ? rawSort.attribute : "id",
		direction: rawSort?.direction === "desc" ? "desc" : "asc",
	};
}

/** General tab: Connection selection and Table Name */
export function GetAllDbGeneralSettings({ block }: { block: BlockNode }) {
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params?.projectId ?? "";
	const connectionId =
		typeof block.data.connection === "string"
			? block.data.connection
			: typeof block.data.integration === "string"
				? block.data.integration
				: typeof block.data.integrationId === "string"
					? block.data.integrationId
					: "";
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
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params?.projectId ?? "";
	const connectionId =
		typeof block.data.connection === "string"
			? block.data.connection
			: typeof block.data.integration === "string"
				? block.data.integration
				: typeof block.data.integrationId === "string"
					? block.data.integrationId
					: "";
	const tableName =
		typeof block.data.tableName === "string"
			? block.data.tableName
			: typeof block.data.table === "string"
				? block.data.table
				: "";
	const { getColumnsForTable, allColumns } = useDbMetadata(projectId, connectionId);
	const tableColumns = getColumnsForTable(tableName);
	const columnSuggestions = tableColumns.length > 0 ? tableColumns : allColumns;
	const sort = parseSort(block);

	const handleSortAttributeChange = (attribute: string) => {
		updateNodeData(block.id, {
			sort: {
				...sort,
				attribute,
			},
		});
	};

	const handleSortDirectionChange = (direction: string) => {
		updateNodeData(block.id, {
			sort: {
				...sort,
				direction: direction as "asc" | "desc",
			},
		});
	};

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
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
				<JsTextField
					fullWidth
					variant="secondary"
					isDisabled={!editable}
					label="Sort Attribute"
					description="Column/attribute to sort on (supports js: expression)."
					placeholder="id"
					value={sort.attribute}
					suggestions={columnSuggestions}
					onChange={handleSortAttributeChange}
				/>
				<Select
					fullWidth
					variant="secondary"
					isDisabled={!editable}
					placeholder="Sort direction"
					value={sort.direction}
					onChange={(val) => handleSortDirectionChange(String(val))}
				>
					<Label>Sort Direction</Label>
					<Select.Trigger>
						<Select.Value />
						<Select.Indicator />
					</Select.Trigger>
					<Description>Direction to sort records by.</Description>
					<Select.Popover>
						<ListBox>
							<ListBox.Item id="asc" textValue="Ascending">
								Ascending
								<ListBox.ItemIndicator />
							</ListBox.Item>
							<ListBox.Item id="desc" textValue="Descending">
								Descending
								<ListBox.ItemIndicator />
							</ListBox.Item>
						</ListBox>
					</Select.Popover>
				</Select>
			</div>
		</div>
	);
}

/** Columns tab: Selected columns array editor (plain strings, no JS expressions) */
export function GetAllDbColumnsSettings({ block }: { block: BlockNode }) {
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params?.projectId ?? "";
	const connectionId =
		typeof block.data.connection === "string"
			? block.data.connection
			: typeof block.data.integration === "string"
				? block.data.integration
				: typeof block.data.integrationId === "string"
					? block.data.integrationId
					: "";
	const tableName =
		typeof block.data.tableName === "string"
			? block.data.tableName
			: typeof block.data.table === "string"
				? block.data.table
				: "";
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
	const connectionId =
		typeof block.data.connection === "string"
			? block.data.connection
			: typeof block.data.integration === "string"
				? block.data.integration
				: typeof block.data.integrationId === "string"
					? block.data.integrationId
					: "";
	const tableName =
		typeof block.data.tableName === "string"
			? block.data.tableName
			: typeof block.data.table === "string"
				? block.data.table
				: "";
	const { tableNames, getColumnsForTable, allColumns } = useDbMetadata(projectId, connectionId);
	const tableColumns = getColumnsForTable(tableName);
	const columnSuggestions = tableColumns.length > 0 ? tableColumns : allColumns;

	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockJoinsEditorField
				blockId={block.id}
				data={block.data}
				name="joins"
				label="Table Joins"
				description="Configure relational table joins for this query."
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
	const connectionId =
		typeof block.data.connection === "string"
			? block.data.connection
			: typeof block.data.integration === "string"
				? block.data.integration
				: typeof block.data.integrationId === "string"
					? block.data.integrationId
					: "";
	const tableName =
		typeof block.data.tableName === "string"
			? block.data.tableName
			: typeof block.data.table === "string"
				? block.data.table
				: "";
	const { getColumnsForTable, allColumns } = useDbMetadata(projectId, connectionId);
	const tableColumns = getColumnsForTable(tableName);
	const columnSuggestions = tableColumns.length > 0 ? tableColumns : allColumns;

	const conditions = parseConditions(block);

	return (
		<div className="flex flex-col gap-4 w-full">
			<ConditionsBuilder
				collapsible={false}
				disableJsConditions={true}
				ignoreOperators={["is_empty", "is_not_empty"]}
				label="Conditions"
				description="The conditions used to match records from the database."
				isDisabled={!editable}
				conditions={conditions}
				lhsSuggestions={columnSuggestions}
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

export function getAllDbSettings(block: BlockNode) {
	const columnsCount = parseColumns(block).length;
	const joinsCount = parseJoins(block).length;
	const conditionsCount = parseConditions(block).length;

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

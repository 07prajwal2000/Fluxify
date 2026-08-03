import {
	ConditionsBuilder,
	type Condition,
} from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import { useDbMetadata } from "@/query/findResourceQuery";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import { BlockSettings } from "../../BlockSettings";
import {
	BlockIntegrationField,
	BlockJsTextField,
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

/** General tab: Connection selection and Table Name */
export function DeleteDbGeneralSettings({ block }: { block: BlockNode }) {
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
				hint="Enter or select the table name to delete the record(s) from, or a JS expression (js:...)."
			/>
		</div>
	);
}

/** Conditions tab: WHERE conditions builder */
export function DeleteDbConditionsSettings({ block }: { block: BlockNode }) {
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
				description="The conditions used to match the records to delete from the database."
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

export function deleteDbSettings(block: BlockNode) {
	const conditionsCount = parseConditions(block).length;

	return [
		<BlockSettings.TabHead key="general" name="General">
			<DeleteDbGeneralSettings block={block} />
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
			<DeleteDbConditionsSettings block={block} />
		</BlockSettings.TabHead>,
	];
}

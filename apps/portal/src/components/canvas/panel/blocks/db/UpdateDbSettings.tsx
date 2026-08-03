import {
	Button,
	ConditionsBuilder,
	Description,
	JavaScriptTextArea,
	JsonEditor,
	Label,
	type Condition,
	type JsonObject,
} from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import { useDbMetadata } from "@/query/findResourceQuery";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import { BlockSettings } from "../../BlockSettings";
import {
	BlockCheckboxField,
	BlockIntegrationField,
	BlockJsTextField,
} from "../../fields";
import type { BlockNode } from "../../../types";

type UpdateDataPayload = {
	source?: "raw" | "js";
	value?: JsonObject | string;
};

type RawWhereCondition = {
	attribute?: string;
	lhs?: string;
	value?: string | number;
	rhs?: string | number;
	operator?: string;
	chain?: "and" | "or";
};

function parseDataPayload(block: BlockNode): UpdateDataPayload {
	const raw = block.data.data;
	if (typeof raw === "object" && raw !== null) {
		return raw as UpdateDataPayload;
	}
	return { source: "raw", value: {} };
}

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

/** General tab: Connection selection, Table Name, and Use Param toggle */
export function UpdateDbGeneralSettings({ block }: { block: BlockNode }) {
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
				hint="Enter or select the table name to update, or a JS expression (js:...)."
			/>
			<BlockCheckboxField
				blockId={block.id}
				data={block.data}
				name="useParam"
				label="Use Parameter"
				description="Use the data from the previous block as the data to update"
			/>
		</div>
	);
}

/** Data tab: JSON Object editor or Custom JavaScript code */
export function UpdateDbDataSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const dataPayload = parseDataPayload(block);
	const source = dataPayload.source ?? "raw";

	const setSource = (nextSource: "raw" | "js") => {
		if (nextSource === source) return;
		if (nextSource === "raw") {
			const nextValue =
				typeof dataPayload.value === "object" && dataPayload.value !== null
					? dataPayload.value
					: {};
			updateNodeData(block.id, {
				data: { source: "raw", value: nextValue },
			});
		} else {
			const nextValue =
				typeof dataPayload.value === "string" ? dataPayload.value : "";
			updateNodeData(block.id, {
				data: { source: "js", value: nextValue },
			});
		}
	};

	const handleRawChange = (nextValue: JsonObject) => {
		updateNodeData(block.id, {
			data: { source: "raw", value: nextValue },
		});
	};

	const handleJsChange = (nextJs: string) => {
		updateNodeData(block.id, {
			data: { source: "js", value: nextJs },
		});
	};

	const rawObject: JsonObject =
		typeof dataPayload.value === "object" && dataPayload.value !== null
			? (dataPayload.value as JsonObject)
			: {};

	const jsCode: string =
		typeof dataPayload.value === "string" ? dataPayload.value : "";

	return (
		<div className="flex flex-col gap-4 w-full">
			<div className="flex flex-col gap-1.5">
				<Label className="text-sm font-medium">Data Format</Label>
				<div className="inline-flex p-1 bg-[var(--background-secondary,#18181b)] border border-[var(--border,#27272a)] rounded-lg gap-1 w-full">
					<Button
						size="sm"
						variant={source === "raw" ? "primary" : "ghost"}
						className="flex-1 text-xs font-medium"
						isDisabled={!editable}
						onPress={() => setSource("raw")}
					>
						Raw JSON
					</Button>
					<Button
						size="sm"
						variant={source === "js" ? "primary" : "ghost"}
						className="flex-1 text-xs font-medium"
						isDisabled={!editable}
						onPress={() => setSource("js")}
					>
						Custom JavaScript
					</Button>
				</div>
			</div>

			{source === "raw" ? (
				<div className="flex flex-col gap-2 w-full">
					<JsonEditor
						rootType="object"
						allowExpressions={true}
						isDisabled={!editable}
						isReadOnly={!editable}
						label="Record Fields"
						description="Define key-value pairs of fields to update. Values support js: expressions."
						value={rawObject}
						onChange={(val) => handleRawChange(val as JsonObject)}
					/>
				</div>
			) : (
				<div className="flex flex-col gap-1.5 w-full">
					<Label className="text-sm font-medium">JavaScript Code</Label>
					<Description className="text-xs text-muted">
						Return a single object of fields to update in the database.
					</Description>
					<JavaScriptTextArea
						rows={12}
						showLineNumbers={true}
						readOnly={!editable}
						value={jsCode}
						onChange={handleJsChange}
					/>
				</div>
			)}
		</div>
	);
}

/** Conditions tab: WHERE conditions builder */
export function UpdateDbConditionsSettings({ block }: { block: BlockNode }) {
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
				description="The conditions used to match the records to update in the database."
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

export function updateDbSettings(block: BlockNode) {
	const useParam = Boolean(block.data.useParam);
	const conditionsCount = parseConditions(block).length;

	const tabs = [
		<BlockSettings.TabHead key="general" name="General">
			<UpdateDbGeneralSettings block={block} />
		</BlockSettings.TabHead>,
	];

	if (!useParam) {
		tabs.push(
			<BlockSettings.TabHead key="data" name="Data to Update">
				<UpdateDbDataSettings block={block} />
			</BlockSettings.TabHead>,
		);
	}

	tabs.push(
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
			<UpdateDbConditionsSettings block={block} />
		</BlockSettings.TabHead>,
	);

	return tabs;
}

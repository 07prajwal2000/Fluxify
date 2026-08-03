import {
	Button,
	Description,
	JavaScriptTextArea,
	JsonEditor,
	Label,
	type JsonArray,
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

type InsertBulkDataPayload = {
	source?: "raw" | "js";
	value?: JsonArray | string;
};

function parseDataPayload(block: BlockNode): InsertBulkDataPayload {
	const raw = block.data.data;
	if (typeof raw === "object" && raw !== null) {
		return raw as InsertBulkDataPayload;
	}
	return { source: "raw", value: [] };
}

/** General tab: Connection selection, Table Name, and Use Param toggle */
export function InsertBulkDbGeneralSettings({ block }: { block: BlockNode }) {
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
				hint="Enter or select the table name to insert records into, or a JS expression (js:...)."
			/>
			<BlockCheckboxField
				blockId={block.id}
				data={block.data}
				name="useParam"
				label="Use Parameter"
				description="Use the data from the previous block as the data to insert"
			/>
		</div>
	);
}

/** Data tab: JSON Array editor or Custom JavaScript code */
export function InsertBulkDbDataSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const dataPayload = parseDataPayload(block);
	const source = dataPayload.source ?? "raw";

	const setSource = (nextSource: "raw" | "js") => {
		if (nextSource === source) return;
		if (nextSource === "raw") {
			const nextValue = Array.isArray(dataPayload.value)
				? dataPayload.value
				: [];
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

	const handleRawChange = (nextValue: JsonArray) => {
		updateNodeData(block.id, {
			data: { source: "raw", value: nextValue },
		});
	};

	const handleJsChange = (nextJs: string) => {
		updateNodeData(block.id, {
			data: { source: "js", value: nextJs },
		});
	};

	const rawArray: JsonArray = Array.isArray(dataPayload.value)
		? (dataPayload.value as JsonArray)
		: [];

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
						rootType="array"
						allowExpressions={true}
						isDisabled={!editable}
						isReadOnly={!editable}
						label="Records Array"
						description="Define array of objects to insert in bulk. Values support js: expressions."
						value={rawArray}
						onChange={(val) => handleRawChange(val as JsonArray)}
					/>
				</div>
			) : (
				<div className="flex flex-col gap-1.5 w-full">
					<Label className="text-sm font-medium">JavaScript Code</Label>
					<Description className="text-xs text-muted">
						Return an array of objects to insert into the database table.
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

export function insertBulkDbSettings(block: BlockNode) {
	const useParam = Boolean(block.data.useParam);

	const tabs = [
		<BlockSettings.TabHead key="general" name="General">
			<InsertBulkDbGeneralSettings block={block} />
		</BlockSettings.TabHead>,
	];

	if (!useParam) {
		tabs.push(
			<BlockSettings.TabHead key="data" name="Data to Insert">
				<InsertBulkDbDataSettings block={block} />
			</BlockSettings.TabHead>,
		);
	}

	return tabs;
}

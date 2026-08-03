import {
	Description,
	JavaScriptTextArea,
	Label,
} from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { TbCode } from "react-icons/tb";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import { BlockSettings } from "../../BlockSettings";
import { BlockIntegrationField } from "../../fields";
import type { BlockNode } from "../../../types";

/** General tab: Connection selection */
export function NativeDbGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockIntegrationField
				blockId={block.id}
				data={block.data}
				name="connection"
				group="database"
				label="Choose Database Connection"
				description="Select the database connection to perform a native database operation."
			/>
		</div>
	);
}

/** Code tab: JavaScript code editor with dbQuery helper info */
export function NativeDbCodeSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();

	const jsCode =
		typeof block.data.js === "string"
			? block.data.js
			: typeof block.data.value === "string"
				? block.data.value
				: "";

	return (
		<div className="flex flex-col gap-4 w-full">
			<div className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--background-secondary,#18181b)] border border-[var(--border,#27272a)] text-xs text-muted leading-relaxed">
				<TbCode className="size-4 shrink-0 text-primary mt-0.5" />
				<div>
					You have access to the async function{" "}
					<code className="font-mono text-foreground font-semibold px-1 py-0.5 rounded bg-[var(--background-tertiary,#27272a)]">
						await dbQuery(query)
					</code>{" "}
					to execute raw queries on the selected database adapter.
				</div>
			</div>

			<div className="flex flex-col gap-1.5 w-full">
				<Label className="text-sm font-medium">JavaScript Code</Label>
				<Description className="text-xs text-muted">
					Write JavaScript code to run queries and return output.
				</Description>
				<JavaScriptTextArea
					rows={14}
					showLineNumbers={true}
					readOnly={!editable}
					value={jsCode}
					onChange={(next) => updateNodeData(block.id, { js: next })}
				/>
			</div>
		</div>
	);
}

export function nativeDbSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="general" name="General">
			<NativeDbGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="code" name="Code">
			<NativeDbCodeSettings block={block} />
		</BlockSettings.TabHead>,
	];
}

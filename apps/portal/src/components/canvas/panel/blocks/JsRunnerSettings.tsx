import { JavaScriptTextArea, Label } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { useCanvasChanges } from "../../changes/ChangesContext";
import type { BlockNode } from "../../types";
import { BlockSettings } from "../BlockSettings";

/** JS Runner block settings: JavaScript code editor using JavaScriptTextArea that expands into the full editor. */
export function JsRunnerSettings({
	block,
	field = "value",
	label = "JavaScript Code",
}: {
	block: BlockNode;
	/** block data key the code is stored under */
	field?: string;
	label?: string;
}) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();

	const code =
		typeof block.data[field] === "string"
			? (block.data[field] as string)
			: typeof block.data.js === "string"
				? block.data.js
				: typeof block.data.code === "string"
					? block.data.code
					: "";

	const title =
		(typeof block.data.name === "string" && block.data.name.trim()) ||
		(typeof block.data.label === "string" && block.data.label.trim()) ||
		"JS Runner";

	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-sm font-medium">{label}</Label>

			<JavaScriptTextArea
				expandable
				expandTitle={`${title} - Code Editor`}
				rows={7}
				showLineNumbers={true}
				readOnly={!editable}
				value={code}
				onChange={(next) => updateNodeData(block.id, { [field]: next })}
			/>
		</div>
	);
}

export function jsRunnerSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<JsRunnerSettings block={block} />
		</BlockSettings.TabHead>
	);
}

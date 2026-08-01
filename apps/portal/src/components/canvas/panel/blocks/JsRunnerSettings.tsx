import { JavaScriptTextArea, Label } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { useCanvasChanges } from "../../changes/ChangesContext";
import { BlockSettings } from "../BlockSettings";
import type { BlockNode } from "../../types";

/** JS Runner block settings: JavaScript code editor using JavaScriptTextArea. */
export function JsRunnerSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const code =
		typeof block.data.value === "string"
			? block.data.value
			: typeof block.data.js === "string"
				? block.data.js
				: typeof block.data.code === "string"
					? block.data.code
					: "";

	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-sm font-medium">JavaScript Code</Label>
			<JavaScriptTextArea
				rows={12}
				showLineNumbers={true}
				readOnly={!editable}
				value={code}
				onChange={(next) => updateNodeData(block.id, { value: next })}
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

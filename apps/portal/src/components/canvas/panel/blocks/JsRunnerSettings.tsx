import {
	Button,
	JavaScriptTextArea,
	JsEditorModal,
	Label,
} from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { useState } from "react";
import { TbArrowsMaximize } from "react-icons/tb";
import { useCanvasChanges } from "../../changes/ChangesContext";
import { BlockSettings } from "../BlockSettings";
import type { BlockNode } from "../../types";

/** JS Runner block settings: JavaScript code editor using JavaScriptTextArea with expandable full modal. */
export function JsRunnerSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const [isModalOpen, setIsModalOpen] = useState(false);

	const code =
		typeof block.data.value === "string"
			? block.data.value
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
			<div className="flex items-center justify-between">
				<Label className="text-sm font-medium">JavaScript Code</Label>
				<Button
					size="sm"
					variant="ghost"
					className="h-7 px-2 text-xs text-muted hover:text-foreground gap-1.5 rounded-md"
					onPress={() => setIsModalOpen(true)}
					aria-label="Expand code editor"
				>
					<TbArrowsMaximize className="size-3.5" />
					<span>Expand</span>
				</Button>
			</div>

			<JavaScriptTextArea
				rows={7}
				showLineNumbers={true}
				readOnly={!editable}
				value={code}
				onChange={(next) => updateNodeData(block.id, { value: next })}
			/>

			<JsEditorModal
				isOpen={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				onSave={() => setIsModalOpen(false)}
				title={`${title} - Code Editor`}
				value={code}
				onChange={(next) => updateNodeData(block.id, { value: next })}
				readOnly={!editable}
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

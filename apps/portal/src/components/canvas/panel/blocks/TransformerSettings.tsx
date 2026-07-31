import {
	Checkbox,
	FieldMapEditor,
	JavaScriptTextArea,
	Label,
} from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { useCanvasChanges } from "../../changes/ChangesContext";
import { BlockSettings } from "../BlockSettings";
import type { BlockNode } from "../../types";

/** Transformer General tab settings: custom Checkbox for useJs toggle. */
export function TransformerGeneralSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const useJs = Boolean(block.data.useJs);

	return (
		<Checkbox
			checked={useJs}
			isDisabled={!editable}
			label="Use JS script"
			description="Use custom JS code to transform data instead of field map"
			onChange={(checked) => updateNodeData(block.id, { useJs: checked })}
		/>
	);
}

/** Transformer Field Map tab settings: FieldMapEditor. */
export function TransformerFieldMapSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const fieldMap =
		typeof block.data.fieldMap === "object" && block.data.fieldMap !== null
			? (block.data.fieldMap as Record<string, string>)
			: {};

	return (
		<FieldMapEditor
			isDisabled={!editable}
			fieldMap={fieldMap}
			label="Field Map"
			description="Map source fields to destination object keys"
			onKeyValueChange={(next) =>
				updateNodeData(block.id, { fieldMap: next })
			}
		/>
	);
}

/** Transformer Custom JavaScript tab settings: JavaScriptTextArea (10 rows, line numbers). */
export function TransformerJsSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const js = typeof block.data.js === "string" ? block.data.js : "";

	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-sm font-medium">JavaScript Code</Label>
			<JavaScriptTextArea
				rows={10}
				showLineNumbers={true}
				readOnly={!editable}
				value={js}
				onChange={(next) => updateNodeData(block.id, { js: next })}
			/>
		</div>
	);
}

export function transformerSettings(block: BlockNode) {
	const useJs = Boolean(block.data.useJs);

	return [
		<BlockSettings.TabHead key="general" name="General">
			<TransformerGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		useJs ? (
			<BlockSettings.TabHead key="js" name="Custom JavaScript">
				<TransformerJsSettings block={block} />
			</BlockSettings.TabHead>
		) : (
			<BlockSettings.TabHead key="fieldmap" name="Field Map">
				<TransformerFieldMapSettings block={block} />
			</BlockSettings.TabHead>
		),
	];
}

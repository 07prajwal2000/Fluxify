import { useSetVarSnippets } from "@fluxify/components";
import { useNodes } from "@xyflow/react";
import type { BlockNode } from "../../types";
import { BlockSettings } from "../BlockSettings";
import { BlockJsTextField, BlockTextField } from "../fields";
import { canvasVariables } from "../SaveOutputField";

/** Set Variable block settings. Configures the variable key and value to set. */
export function SetVarSettings({ block }: { block: BlockNode }) {
	// live nodes, so a renamed block shows its new name in the snippets
	const otherVars = canvasVariables(useNodes().filter((n) => n.id !== block.id));

	const currentKey = typeof block.data?.key === "string" ? block.data.key.trim() : "";

	useSetVarSnippets(currentKey, otherVars);

	return (
		<div className="flex flex-col gap-4">
			<BlockTextField
				blockId={block.id}
				data={block.data}
				name="key"
				label="Variable Name"
				placeholder="e.g. user, totalAmount"
				hint="The name of the variable to set in context."
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="value"
				label="Value"
				placeholder="Value or js: expression"
				hint="The value to assign (number, boolean, string, object, or JS expression)."
			/>
		</div>
	);
}

export function setVarSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<SetVarSettings block={block} />
		</BlockSettings.TabHead>
	);
}

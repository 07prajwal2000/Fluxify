import { BlockSettings } from "../BlockSettings";
import { BlockJsTextField, BlockTextField } from "../fields";
import type { BlockNode } from "../../types";

/** Set Variable block settings. Configures the variable key and value to set. */
export function SetVarSettings({ block }: { block: BlockNode }) {
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

import { BlockSettings } from "../BlockSettings";
import { BlockTextField } from "../fields";
import type { BlockNode } from "../../types";

/** Get Variable block settings. Configures the variable key to read. */
export function GetVarSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4">
			<BlockTextField
				blockId={block.id}
				data={block.data}
				name="key"
				label="Variable Name"
				placeholder="Type or enter variable name"
				hint="The name of the variable to read from context."
			/>
		</div>
	);
}

export function getVarSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<GetVarSettings block={block} />
		</BlockSettings.TabHead>
	);
}

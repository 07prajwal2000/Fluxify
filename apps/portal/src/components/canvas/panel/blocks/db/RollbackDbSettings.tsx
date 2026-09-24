import type { BlockNode } from "../../../types";
import { BlockSettings } from "../../BlockSettings";
import { BlockJsTextField } from "../../fields";

/** General tab: the reason handed to the transaction's failure path */
export function RollbackDbGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="message"
				label="Message"
				placeholder="transaction rolled back"
				hint="Rolls back the enclosing transaction and stops here. The transaction's failure path gets { reason: 'rollback', message }."
			/>
		</div>
	);
}

export function rollbackDbSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead key="general" name="General">
			<RollbackDbGeneralSettings block={block} />
		</BlockSettings.TabHead>
	);
}

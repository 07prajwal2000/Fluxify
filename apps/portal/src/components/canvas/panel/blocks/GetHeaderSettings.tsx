import { BlockSettings } from "../BlockSettings";
import { BlockJsTextField } from "../fields";
import type { BlockNode } from "../../types";

/** Get Header block settings. Configures the header name to read from request. */
export function GetHeaderSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4">
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="name"
				label="Header Name"
				placeholder="Authorization"
				hint="The name of the header to get from the request. Also accepts JS expression"
			/>
		</div>
	);
}

export function getHeaderSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<GetHeaderSettings block={block} />
		</BlockSettings.TabHead>
	);
}

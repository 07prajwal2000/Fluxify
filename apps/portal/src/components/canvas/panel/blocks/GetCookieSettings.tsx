import { BlockSettings } from "../BlockSettings";
import { BlockJsTextField } from "../fields";
import type { BlockNode } from "../../types";

/** Get Cookie block settings. Configures the cookie name to read from request. */
export function GetCookieSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4">
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="name"
				label="Cookie Name"
				placeholder="Authorization"
				hint="The name of the cookie to get from the request. Also accepts JS expression"
			/>
		</div>
	);
}

export function getCookieSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<GetCookieSettings block={block} />
		</BlockSettings.TabHead>
	);
}

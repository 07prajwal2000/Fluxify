import type { BlockNode } from "../../types";
import { BlockSettings } from "../BlockSettings";
import { BlockJsTextField } from "../fields";
import { SingleOrMultiple } from "./SingleOrMultiple";

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
			<SingleOrMultiple
				block={block}
				fields={[{ name: "name", label: "Cookie Name" }]}
				single={<GetCookieSettings block={block} />}
				addLabel="Add cookie"
			/>
		</BlockSettings.TabHead>
	);
}

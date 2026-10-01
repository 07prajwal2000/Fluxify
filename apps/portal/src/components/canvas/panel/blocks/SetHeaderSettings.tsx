import type { BlockNode } from "../../types";
import { BlockSettings } from "../BlockSettings";
import { BlockJsTextField } from "../fields";
import { SingleOrMultiple } from "./SingleOrMultiple";

export function SetHeaderSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="name"
				label="Header Name"
				placeholder="Authorization"
				hint="The name of the header to set (supports js: expression)."
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="value"
				label="Header Value"
				placeholder="Bearer token-123"
				hint="The value of the header to set (supports js: expression)."
			/>
		</div>
	);
}

export function setHeaderSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<SingleOrMultiple
				block={block}
				fields={[
					{ name: "name", label: "Header Name" },
					{ name: "value", label: "Header Value" },
				]}
				single={<SetHeaderSettings block={block} />}
				addLabel="Add header"
			/>
		</BlockSettings.TabHead>
	);
}

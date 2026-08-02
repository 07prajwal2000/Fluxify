import { BlockSettings } from "../BlockSettings";
import {
	BlockIntegrationField,
	BlockJsTextField,
	BlockSelectField,
} from "../fields";
import type { BlockNode } from "../../types";

const LOG_LEVEL_OPTIONS = [
	{ value: "info", label: "Info" },
	{ value: "warn", label: "Warn" },
	{ value: "error", label: "Error" },
];

export function CloudLogSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockIntegrationField
				blockId={block.id}
				data={block.data}
				name="connection"
				group="observability"
				label="Observability Connection"
				description="Select the observability connection to use for this block."
			/>

			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="level"
				label="Log Level"
				options={LOG_LEVEL_OPTIONS}
				placeholder="Select log level"
				hint="Severity level of the log message."
			/>

			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="message"
				label="Message"
				placeholder="Hello World"
				hint="The message to log (supports js: expression). Falls back to incoming block value if empty."
			/>
		</div>
	);
}

export function cloudLogSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<CloudLogSettings block={block} />
		</BlockSettings.TabHead>
	);
}

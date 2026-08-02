import { BlockSettings } from "../BlockSettings";
import { BlockJsTextField, BlockSelectField } from "../fields";
import type { BlockNode } from "../../types";

const LOG_LEVEL_OPTIONS = [
	{ value: "info", label: "Info" },
	{ value: "warn", label: "Warn" },
	{ value: "error", label: "Error" },
];

export function ConsoleLogSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
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

export function consoleLogSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<ConsoleLogSettings block={block} />
		</BlockSettings.TabHead>
	);
}

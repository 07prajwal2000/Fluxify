import { TbInfoCircle } from "react-icons/tb";
import type { BlockNode } from "../../types";
import { BlockSettings } from "../BlockSettings";
import { BlockSelectField, BlockTextField } from "../fields";

export function RetryGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<div className="flex items-start gap-2.5 p-3 rounded-lg bg-background-secondary border border-border text-xs text-muted leading-relaxed">
				<TbInfoCircle className="size-4 shrink-0 text-accent mt-0.5" />
				<div>
					Connect blocks to the <strong>executor port</strong>. If they throw an error, they run
					again. The <strong>success</strong> path gets the executor chain's last output. When every
					try fails, the <strong>failure</strong> path gets <code>{"{ attempts, message }"}</code>.
					With no failure path, the last error fails the run. A retry runs writes again too, so they
					can happen more than once.
				</div>
			</div>
			<BlockTextField
				blockId={block.id}
				data={block.data}
				name="maxRetries"
				label="Max retries"
				placeholder="3"
				hint="Tries after the first one, 1 to 10. Default: 3."
			/>
		</div>
	);
}

/** Delay tab: how long to wait between tries */
export function RetryDelaySettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="retryType"
				label="Retry type"
				options={[
					{ value: "none", label: "Immediate" },
					{ value: "fixed", label: "Fixed delay" },
					{ value: "linear", label: "Linear backoff" },
					{ value: "exponential", label: "Exponential backoff" },
					{ value: "exponential_jitter", label: "Exponential backoff + jitter" },
				]}
			/>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
				<BlockTextField
					blockId={block.id}
					data={block.data}
					name="delayMs"
					label="Delay (ms)"
					placeholder="1000"
					hint="Starting wait, 0 to 30000. Default: 1000."
				/>
				<BlockTextField
					blockId={block.id}
					data={block.data}
					name="maxDelayMs"
					label="Max delay (ms)"
					placeholder="30000"
					hint="Longest single wait, 0 to 30000. Default: 30000."
				/>
			</div>
		</div>
	);
}

export function retrySettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="general" name="General">
			<RetryGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="delay" name="Delay">
			<RetryDelaySettings block={block} />
		</BlockSettings.TabHead>,
	];
}

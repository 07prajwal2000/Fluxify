import { BlockSettings } from "../BlockSettings";
import {
	BlockCheckboxField,
	BlockJsTextField,
	BlockSelectField,
	BlockWorkflowField,
} from "../fields";
import type { BlockNode } from "../../types";

function TriggerWorkflowGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex w-full flex-col gap-4">
			<BlockWorkflowField
				blockId={block.id}
				data={block.data}
				name="workflowId"
				label="Workflow"
				description="Queued, not called — this block carries on as soon as the run is accepted."
			/>

			<BlockCheckboxField
				blockId={block.id}
				data={block.data}
				name="useInput"
				label="Use incoming value"
				hint="Send the previous block's output. Turn this off to write the data yourself in the Data tab."
			/>
		</div>
	);
}

function TriggerWorkflowDataSettings({ block }: { block: BlockNode }) {
	if (block.data.useInput) {
		return (
			<p className="text-sm text-muted">
				This block is sending the previous block's output. Turn off{" "}
				<b className="text-foreground">Use incoming value</b> in General to write
				the data here instead.
			</p>
		);
	}

	return (
		<BlockJsTextField
			blockId={block.id}
			data={block.data}
			name="data"
			label="Data"
			placeholder={"js: return { orderId: input.id };"}
			hint="What the workflow receives. Keep it small — oversized payloads are rejected, so send a reference and let the workflow load the rest."
		/>
	);
}

const ATTEMPT_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));

const DELAY_OPTIONS = [
	{ value: "1000", label: "1 second" },
	{ value: "5000", label: "5 seconds" },
	{ value: "10000", label: "10 seconds" },
	{ value: "30000", label: "30 seconds" },
	{ value: "60000", label: "1 minute" },
];

function TriggerWorkflowRetrySettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex w-full flex-col gap-4">
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="maxAttempts"
				label="Max attempts"
				placeholder="Default (5)"
				options={ATTEMPT_OPTIONS}
				hint="How many times the workflow runs before the event is dropped."
			/>
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="retryDelayMs"
				label="Retry delay"
				placeholder="Default (10 seconds)"
				options={DELAY_OPTIONS}
				hint="Wait before the first retry. It doubles after each failed attempt."
			/>
		</div>
	);
}

export function triggerWorkflowSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="general" name="General">
			<TriggerWorkflowGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="data" name="Data">
			<TriggerWorkflowDataSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="retry" name="Retry">
			<TriggerWorkflowRetrySettings block={block} />
		</BlockSettings.TabHead>,
	];
}

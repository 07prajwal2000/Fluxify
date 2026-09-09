import { BlockSettings } from "../BlockSettings";
import {
	BlockCheckboxField,
	BlockJsTextField,
	BlockWorkflowField,
} from "../fields";
import type { BlockNode } from "../../types";

export function TriggerWorkflowSettings({ block }: { block: BlockNode }) {
	const useInput = Boolean(block.data.useInput);

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
				hint="Send the previous block's output instead of the data below."
			/>

			{!useInput && (
				<BlockJsTextField
					blockId={block.id}
					data={block.data}
					name="data"
					label="Data"
					placeholder={'js: return { orderId: input.id };'}
					hint="What the workflow receives. Keep it small — large payloads are rejected; pass a reference instead."
				/>
			)}
		</div>
	);
}

export function triggerWorkflowSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<TriggerWorkflowSettings block={block} />
		</BlockSettings.TabHead>
	);
}

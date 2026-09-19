import type { BlockNode } from "../../../types";
import { BlockSettings } from "../../BlockSettings";
import {
	BlockCheckboxField,
	BlockIntegrationField,
	BlockJsTextField,
	BlockSelectField,
} from "../../fields";

/** General tab: which KV store to talk to. */
export function KvOperationsGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockIntegrationField
				blockId={block.id}
				data={block.data}
				name="connection"
				group="kv"
				label="Choose KV Connection"
				description="Select the Redis or Memcached connection this block operates on."
			/>
		</div>
	);
}

/**
 * Operation tab: the op dropdown plus only the fields that op uses — `set`
 * takes a value and an optional TTL, `get` and `delete` take just the key.
 */
export function KvOperationsOperationSettings({ block }: { block: BlockNode }) {
	const operation = String(block.data.operation ?? "");
	const useParam = Boolean(block.data.useParam);

	return (
		<div className="flex flex-col gap-4">
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="operation"
				label="Operation"
				placeholder="Select an operation"
				hint="Select the operation to perform on the store"
				options={[
					{ value: "get", label: "Get" },
					{ value: "set", label: "Set" },
					{ value: "delete", label: "Delete" },
				]}
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="key"
				label="Key"
				placeholder="Key or js: expression"
				hint="The key to operate on (can be a JS expression)"
			/>
			{operation === "get" && (
				<BlockCheckboxField
					blockId={block.id}
					data={block.data}
					name="parseJson"
					label="Parse JSON"
					description="Parse the stored string as JSON before passing it on?"
				/>
			)}
			{operation === "set" && (
				<>
					<BlockCheckboxField
						blockId={block.id}
						data={block.data}
						name="useParam"
						label="Use Param"
						description="Store the previous block's output instead of a value?"
					/>
					{!useParam && (
						<BlockJsTextField
							blockId={block.id}
							data={block.data}
							name="value"
							label="Value"
							placeholder="Value or js: expression"
							hint="Value to store. Anything that is not a string is stored as JSON"
						/>
					)}
					<BlockJsTextField
						blockId={block.id}
						data={block.data}
						name="ttl"
						label="TTL (seconds)"
						placeholder="Leave empty for no expiry"
						hint="Seconds until the key expires. Empty or 0 stores it without expiry"
					/>
				</>
			)}
		</div>
	);
}

export function kvOperationsSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="general" name="General">
			<KvOperationsGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="operation" name="Operation">
			<KvOperationsOperationSettings block={block} />
		</BlockSettings.TabHead>,
	];
}

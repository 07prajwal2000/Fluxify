import { useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import { useSetVarSnippets } from "@fluxify/components";
import { BlockSettings } from "../BlockSettings";
import { BlockJsTextField, BlockTextField } from "../fields";
import type { BlockNode } from "../../types";

/** Set Variable block settings. Configures the variable key and value to set. */
export function SetVarSettings({ block }: { block: BlockNode }) {
	const { getNodes } = useReactFlow();

	const otherVars = useMemo(() => {
		try {
			const nodes = getNodes?.() ?? [];
			return nodes
				.filter(
					(n) => n.type === "setvar" && n.id !== block.id && n.data?.key,
				)
				.map((n) => String(n.data?.key).trim())
				.filter(Boolean);
		} catch {
			return [];
		}
	}, [getNodes, block.id]);

	const currentKey =
		typeof block.data?.key === "string" ? block.data.key.trim() : "";

	useSetVarSnippets(currentKey, otherVars);

	return (
		<div className="flex flex-col gap-4">
			<BlockTextField
				blockId={block.id}
				data={block.data}
				name="key"
				label="Variable Name"
				placeholder="e.g. user, totalAmount"
				hint="The name of the variable to set in context."
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="value"
				label="Value"
				placeholder="Value or js: expression"
				hint="The value to assign (number, boolean, string, object, or JS expression)."
			/>
		</div>
	);
}

export function setVarSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<SetVarSettings block={block} />
		</BlockSettings.TabHead>
	);
}

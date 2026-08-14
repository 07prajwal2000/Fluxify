import type { RuleEditorProps } from "../types";
import { getRuleValue, updateRule } from "../utils";
import { RuleNumberField, RuleSectionTitle, RuleTextField } from "./fields";

/**
 * `file` is a multipart field, `blob` a raw binary body. Both validate the same
 * three things server-side, so they share one editor.
 */
export function FileRules({ node, onUpdate, isReadOnly }: RuleEditorProps) {
	const set = (type: string, value: unknown) =>
		onUpdate({ rules: updateRule(node.rules, type, value) });

	// Stored as a comma-separated string; the parser accepts that or a list.
	const mimeTypes = getRuleValue<string | string[]>(node.rules, "mimeTypes", "");

	return (
		<div className="flex flex-col gap-4">
			<RuleSectionTitle>
				{node.dataType === "blob" ? "Binary" : "File"} validation rules
			</RuleSectionTitle>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<RuleNumberField
					description="In bytes."
					isReadOnly={isReadOnly}
					label="Minimum size"
					min={0}
					onChange={(next) => set("minSize", next)}
					placeholder="e.g. 1024"
					value={getRuleValue<number | "">(node.rules, "minSize", "")}
				/>
				<RuleNumberField
					description="In bytes. 2 MB is 2097152."
					isReadOnly={isReadOnly}
					label="Maximum size"
					min={0}
					onChange={(next) => set("maxSize", next)}
					placeholder="e.g. 2097152"
					value={getRuleValue<number | "">(node.rules, "maxSize", "")}
				/>
			</div>

			<RuleTextField
				description="Comma-separated. Leave empty to accept any type."
				isReadOnly={isReadOnly}
				label="Allowed MIME types"
				onChange={(next) => set("mimeTypes", next)}
				placeholder="e.g. image/png, image/jpeg"
				value={Array.isArray(mimeTypes) ? mimeTypes.join(", ") : mimeTypes}
			/>
		</div>
	);
}

import { JavaScriptTextArea } from "../../JavaScriptTextArea";
import { DEFAULT_JS } from "../constants";
import { InfoNote } from "../InfoNote";
import type { RuleEditorProps } from "../types";
import { RuleSectionTitle } from "./fields";

/**
 * The validator source lives on the node's `js` field, which is where
 * `buildZodSchema` reads it. It is deliberately not a rule — a `jsCode` rule
 * would be written but never executed.
 */
export function JsRules({
	node,
	onUpdate,
	isReadOnly,
	jsEditorRows = 12,
}: RuleEditorProps) {
	return (
		<div className="flex flex-col gap-4">
			<RuleSectionTitle>Custom JavaScript validation</RuleSectionTitle>

			<InfoNote>
				Return a boolean to pass or fail. The value under validation is{" "}
				<code className="font-mono">input</code>. To return a custom error
				body, throw:{" "}
				<code className="font-mono">
					{'throw new ValidationError({ your: "error" })'}
				</code>
				.
			</InfoNote>

			<JavaScriptTextArea
				aria-label="Custom JavaScript validation"
				onChange={(next) => onUpdate({ js: next })}
				readOnly={isReadOnly}
				rows={jsEditorRows}
				value={node.js ?? DEFAULT_JS}
			/>
		</div>
	);
}

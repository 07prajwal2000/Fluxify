import type { RuleEditorProps } from "../types";
import { getRuleValue, updateRule } from "../utils";
import { RuleNumberField, RuleSectionTitle } from "./fields";

export function NumberRules({ node, onUpdate, isReadOnly }: RuleEditorProps) {
	const set = (type: string, value: unknown) =>
		onUpdate({ rules: updateRule(node.rules, type, value) });

	const isFloat = node.dataType === "float";

	return (
		<div className="flex flex-col gap-4">
			<RuleSectionTitle>
				{isFloat ? "Float" : "Integer"} validation rules
			</RuleSectionTitle>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<RuleNumberField
					isReadOnly={isReadOnly}
					label="Minimum value"
					onChange={(next) => set("min", next)}
					placeholder="e.g. 0"
					step={isFloat ? 0.01 : 1}
					value={getRuleValue<number | "">(node.rules, "min", "")}
				/>
				<RuleNumberField
					isReadOnly={isReadOnly}
					label="Maximum value"
					onChange={(next) => set("max", next)}
					placeholder="e.g. 100"
					step={isFloat ? 0.01 : 1}
					value={getRuleValue<number | "">(node.rules, "max", "")}
				/>
			</div>
		</div>
	);
}

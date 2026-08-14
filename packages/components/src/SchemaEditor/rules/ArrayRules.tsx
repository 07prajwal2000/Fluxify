import type { RuleEditorProps } from "../types";
import { getRuleValue, updateRule } from "../utils";
import { RuleNumberField, RuleSectionTitle } from "./fields";

/**
 * Length only. An array's element schema is a real sub-schema (`items`), edited
 * by navigating into it — not a rule, which is why there is no item-type
 * dropdown here.
 */
export function ArrayRules({ node, onUpdate, isReadOnly }: RuleEditorProps) {
	const set = (type: string, value: unknown) =>
		onUpdate({ rules: updateRule(node.rules, type, value) });

	return (
		<div className="flex flex-col gap-4">
			<RuleSectionTitle>Array validation rules</RuleSectionTitle>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<RuleNumberField
					isReadOnly={isReadOnly}
					label="Minimum items"
					min={0}
					onChange={(next) => set("minItems", next)}
					placeholder="e.g. 1"
					value={getRuleValue<number | "">(node.rules, "minItems", "")}
				/>
				<RuleNumberField
					isReadOnly={isReadOnly}
					label="Maximum items"
					min={0}
					onChange={(next) => set("maxItems", next)}
					placeholder="e.g. 10"
					value={getRuleValue<number | "">(node.rules, "maxItems", "")}
				/>
			</div>

			<p className="text-xs text-muted">
				Open this array from the editor to configure the schema its items must
				match.
			</p>
		</div>
	);
}

import type { RuleEditorProps } from "../types";
import { getRuleValue, updateRule } from "../utils";
import { RuleNumberField, RuleSectionTitle, RuleTextField } from "./fields";

/** Every rule here maps 1:1 onto a Zod call in the server's `applyRules`. */
export function StringRules({ node, onUpdate, isReadOnly }: RuleEditorProps) {
	const set = (type: string, value: unknown) =>
		onUpdate({ rules: updateRule(node.rules, type, value) });

	return (
		<div className="flex flex-col gap-4">
			<RuleSectionTitle>String validation rules</RuleSectionTitle>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<RuleNumberField
					isReadOnly={isReadOnly}
					label="Minimum length"
					min={0}
					onChange={(next) => set("minLength", next)}
					placeholder="e.g. 3"
					value={getRuleValue<number | "">(node.rules, "minLength", "")}
				/>
				<RuleNumberField
					isReadOnly={isReadOnly}
					label="Maximum length"
					min={0}
					onChange={(next) => set("maxLength", next)}
					placeholder="e.g. 255"
					value={getRuleValue<number | "">(node.rules, "maxLength", "")}
				/>
			</div>

			<div className="h-px w-full bg-border" />

			<RuleTextField
				description="A JavaScript regular expression, without delimiters."
				isReadOnly={isReadOnly}
				label="Regex pattern"
				onChange={(next) => set("regex", next)}
				placeholder="e.g. ^[a-z]+$"
				value={getRuleValue(node.rules, "regex", "")}
			/>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<RuleTextField
					isReadOnly={isReadOnly}
					label="Starts with"
					onChange={(next) => set("startsWith", next)}
					placeholder="e.g. usr_"
					value={getRuleValue(node.rules, "startsWith", "")}
				/>
				<RuleTextField
					isReadOnly={isReadOnly}
					label="Ends with"
					onChange={(next) => set("endsWith", next)}
					placeholder="e.g. .com"
					value={getRuleValue(node.rules, "endsWith", "")}
				/>
				<RuleTextField
					isReadOnly={isReadOnly}
					label="Contains"
					onChange={(next) => set("contains", next)}
					placeholder="e.g. hello"
					value={getRuleValue(node.rules, "contains", "")}
				/>
				<RuleTextField
					isReadOnly={isReadOnly}
					label="Does not contain"
					onChange={(next) => set("notContains", next)}
					placeholder="e.g. badword"
					value={getRuleValue(node.rules, "notContains", "")}
				/>
			</div>
		</div>
	);
}

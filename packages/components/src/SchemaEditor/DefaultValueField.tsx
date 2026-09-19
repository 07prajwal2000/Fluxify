import { ListBox, Select } from "@heroui/react";
import type { ReactNode } from "react";
import { RuleNumberField, RuleSectionTitle, RuleTextField } from "./rules/fields";
import type { SchemaNode, SchemaProperty } from "./types";
import { DEFAULTABLE_TYPES, getRuleValue, parseDefault } from "./utils";

const NONE = "__none__";
const LABEL = "Default value";
const DESCRIPTION = "Used when the request leaves this field out.";

/** Only an optional field of a simple type can fall back to a default. */
export const hasDefaultValue = (node: SchemaNode) =>
	(node as SchemaProperty).required === false && DEFAULTABLE_TYPES.includes(node.dataType);

interface DefaultValueFieldProps {
	node: SchemaNode;
	onUpdate: (updates: Partial<SchemaProperty>) => void;
	isReadOnly?: boolean;
}

/** The input matches the field's type, so only a valid default can be stored. */
export function DefaultValueField({ node, onUpdate, isReadOnly }: DefaultValueFieldProps) {
	if (!hasDefaultValue(node)) return null;
	const property = node as SchemaProperty;
	const current = property.default;
	const set = (raw: string) => onUpdate({ default: parseDefault(property, raw) });

	let input: ReactNode;
	switch (property.dataType) {
		case "int":
		case "float":
			input = (
				<RuleNumberField
					description={DESCRIPTION}
					isReadOnly={isReadOnly}
					label={LABEL}
					onChange={(next) => set(String(next))}
					placeholder="No default"
					step={property.dataType === "int" ? 1 : 0.01}
					value={typeof current === "number" ? current : ""}
				/>
			);
			break;
		case "bool":
			input = (
				<DefaultSelect
					isReadOnly={isReadOnly}
					onChange={set}
					options={["true", "false"]}
					value={current}
				/>
			);
			break;
		case "enum":
			input = (
				<DefaultSelect
					isReadOnly={isReadOnly}
					onChange={set}
					options={getRuleValue<unknown[]>(property.rules, "values", []).map(String)}
					value={current}
				/>
			);
			break;
		default:
			input = (
				<RuleTextField
					description={DESCRIPTION}
					isReadOnly={isReadOnly}
					label={LABEL}
					onChange={set}
					placeholder="No default"
					value={typeof current === "string" ? current : ""}
				/>
			);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="h-px w-full bg-border" />
			<RuleSectionTitle>Default</RuleSectionTitle>
			{input}
		</div>
	);
}

function DefaultSelect({
	options,
	value,
	onChange,
	isReadOnly,
}: {
	options: string[];
	value: unknown;
	onChange: (raw: string) => void;
	isReadOnly?: boolean;
}) {
	return (
		<div className="flex w-full flex-col gap-1.5">
			<span className="text-xs font-medium text-muted-foreground">{LABEL}</span>
			<Select
				aria-label={LABEL}
				fullWidth
				isDisabled={isReadOnly}
				onSelectionChange={(key) => onChange(key === NONE ? "" : String(key))}
				selectedKey={value === undefined ? NONE : String(value)}
				variant="secondary"
			>
				<Select.Trigger>
					<Select.Value />
					<Select.Indicator />
				</Select.Trigger>
				<Select.Popover>
					<ListBox>
						{[NONE, ...options].map((option) => (
							<ListBox.Item
								id={option}
								key={option}
								textValue={option === NONE ? "No default" : option}
							>
								{option === NONE ? "No default" : option}
								<ListBox.ItemIndicator />
							</ListBox.Item>
						))}
					</ListBox>
				</Select.Popover>
			</Select>
			<p className="text-xs text-muted">{DESCRIPTION}</p>
		</div>
	);
}

import { ListBox, Select } from "@heroui/react";
import type { RuleEditorProps } from "../types";
import { getRuleValue, updateRule } from "../utils";
import { RuleNumberField, RuleSectionTitle, RuleTextField } from "./fields";

const FORMATS = [
	{ id: "none", label: "None" },
	{ id: "uuidv4", label: "UUID v4" },
	{ id: "uuidv7", label: "UUID v7" },
	{ id: "email", label: "Email" },
	{ id: "url", label: "URL (any protocol)" },
	{ id: "ipv4", label: "IPv4 address" },
	{ id: "ipv6", label: "IPv6 address" },
	{ id: "datetime", label: "ISO 8601 date-time" },
];

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

			<div className="flex w-full flex-col gap-1.5">
				<span className="text-xs font-medium text-muted-foreground">Format</span>
				<Select
					aria-label="Format"
					fullWidth
					isDisabled={isReadOnly}
					// "none" clears the rule: updateRule drops an empty value
					onSelectionChange={(key) => set("format", key === "none" ? "" : key)}
					selectedKey={getRuleValue(node.rules, "format", "none")}
					variant="secondary"
				>
					<Select.Trigger>
						<Select.Value />
						<Select.Indicator />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							{FORMATS.map((format) => (
								<ListBox.Item id={format.id} key={format.id} textValue={format.label}>
									{format.label}
									<ListBox.ItemIndicator />
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>
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

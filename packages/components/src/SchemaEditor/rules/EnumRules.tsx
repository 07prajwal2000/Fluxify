import { Button, InputGroup, ListBox, Select, TextField } from "@heroui/react";
import { useState } from "react";
import { TbPlus } from "react-icons/tb";
import { DeleteIconButton } from "../../DeleteButton";
import type { RuleEditorProps } from "../types";
import { getRuleValue, updateRule } from "../utils";
import { RuleSectionTitle } from "./fields";

type EnumValue = string | number;
type ValueKind = "string" | "number";

/** The parser infers the enum's kind from the values, so it is never persisted. */
function inferKind(values: EnumValue[]): ValueKind {
	return values.length > 0 && values.every((v) => typeof v === "number")
		? "number"
		: "string";
}

/**
 * Writes the `values` rule — the one shape `schemaParser` reads to build
 * `z.enum(...)`. Values are stored as their real type: a numeric enum built as
 * strings would reject every number the client sends.
 */
export function EnumRules({ node, onUpdate, isReadOnly }: RuleEditorProps) {
	const values = getRuleValue<EnumValue[]>(node.rules, "values", []);
	const [kind, setKind] = useState<ValueKind>(() => inferKind(values));

	const commit = (next: EnumValue[]) =>
		onUpdate({ rules: updateRule(node.rules, "values", next) });

	const handleKindChange = (nextKind: ValueKind) => {
		setKind(nextKind);
		commit(
			values.map((value) =>
				nextKind === "number" ? (Number(value) || 0) : String(value),
			),
		);
	};

	const handleValueChange = (index: number, raw: string) => {
		const next = [...values];
		next[index] = kind === "number" ? (raw === "" ? 0 : Number(raw)) : raw;
		commit(next);
	};

	return (
		<div className="flex flex-col gap-4">
			<RuleSectionTitle>Enum configuration</RuleSectionTitle>

			<div className="flex w-full flex-col gap-1.5">
				<span className="text-xs font-medium text-muted-foreground">
					Value type
				</span>
				<Select
					fullWidth
					isDisabled={isReadOnly}
					onSelectionChange={(key) => handleKindChange(key as ValueKind)}
					selectedKey={kind}
					variant="secondary"
				>
					<Select.Trigger>
						<Select.Value />
						<Select.Indicator />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							<ListBox.Item id="string" textValue="String">
								String
								<ListBox.ItemIndicator />
							</ListBox.Item>
							<ListBox.Item id="number" textValue="Number">
								Number
								<ListBox.ItemIndicator />
							</ListBox.Item>
						</ListBox>
					</Select.Popover>
				</Select>
			</div>

			<div className="h-px w-full bg-border" />

			<span className="text-xs font-medium text-muted-foreground">
				Allowed values
			</span>

			{values.length === 0 && (
				<p className="text-xs text-muted">
					No values yet — an enum with no values accepts anything.
				</p>
			)}

			<div className="flex flex-col gap-2">
				{values.map((value, index) => (
					// Index keys are correct here: the row *is* its position, and the
					// values themselves are editable and may repeat while typing.
					// biome-ignore lint/suspicious/noArrayIndexKey: see above
					<div className="flex items-center gap-2" key={index}>
						<TextField fullWidth isDisabled={isReadOnly} variant="secondary">
							<InputGroup fullWidth variant="secondary">
								<InputGroup.Input
									aria-label={`Value ${index + 1}`}
									onChange={(event) =>
										handleValueChange(index, event.currentTarget.value)
									}
									placeholder={`Value ${index + 1}`}
									type={kind === "number" ? "number" : "text"}
									value={String(value)}
								/>
							</InputGroup>
						</TextField>
						{!isReadOnly && (
							<DeleteIconButton
								aria-label={`Remove value ${index + 1}`}
								onPress={() => commit(values.filter((_, i) => i !== index))}
								size="sm"
							/>
						)}
					</div>
				))}
			</div>

			{!isReadOnly && (
				<div>
					<Button
						onPress={() => commit([...values, kind === "number" ? 0 : ""])}
						size="sm"
						variant="secondary"
					>
						<TbPlus className="mr-1 size-4" />
						Add value
					</Button>
				</div>
			)}
		</div>
	);
}

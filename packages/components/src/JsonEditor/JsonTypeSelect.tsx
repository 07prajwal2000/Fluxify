import { ListBox, Select } from "@heroui/react";
import type { JsonValueType } from "./types";

const TYPE_OPTIONS: ReadonlyArray<{
	value: JsonValueType;
	label: string;
}> = [
	{ value: "string", label: "String" },
	{ value: "number", label: "Number" },
	{ value: "boolean", label: "Boolean" },
	{ value: "object", label: "Object" },
	{ value: "array", label: "Array" },
	{ value: "null", label: "Null" },
];

interface JsonTypeSelectProps {
	value: JsonValueType;
	onChange: (value: JsonValueType) => void;
	isDisabled?: boolean;
	ariaLabel?: string;
	className?: string;
}

export function JsonTypeSelect({
	value,
	onChange,
	isDisabled,
	ariaLabel = "JSON value type",
	className,
}: JsonTypeSelectProps) {
	return (
		<Select
			aria-label={ariaLabel}
			className={className}
			isDisabled={isDisabled}
			onChange={(nextValue) => {
				if (typeof nextValue === "string") {
					onChange(nextValue as JsonValueType);
				}
			}}
			value={value}
			variant="secondary"
		>
			<Select.Trigger>
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{TYPE_OPTIONS.map((option) => (
						<ListBox.Item
							id={option.value}
							key={option.value}
							textValue={option.label}
						>
							{option.label}
							<ListBox.ItemIndicator />
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}


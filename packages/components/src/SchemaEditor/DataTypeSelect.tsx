import { ListBox, Select } from "@heroui/react";
import type { DataType, DataTypeOption } from "./types";

/** The single type dropdown, shared by the root, every property and array items. */
export function DataTypeSelect({
	value,
	options,
	onChange,
	isDisabled,
	label,
	className,
}: {
	value: DataType;
	options: DataTypeOption[];
	onChange: (next: DataType) => void;
	isDisabled?: boolean;
	label: string;
	className?: string;
}) {
	return (
		<Select
			aria-label={label}
			className={className}
			fullWidth
			isDisabled={isDisabled}
			onSelectionChange={(key) => key && onChange(key as DataType)}
			selectedKey={value}
			variant="secondary"
		>
			<Select.Trigger>
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{options.map((option) => (
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

import { Label, ListBox, Select } from "@heroui/react";
import type { SelectProps } from "@heroui/react";
import type { ReactNode } from "react";

export interface CustomSelectOption {
	value: string;
	label: string;
}

export interface CustomSelectProps extends Omit<SelectProps<object>, "children" | "onChange" | "value" | "defaultValue"> {
	label?: ReactNode;
	options: CustomSelectOption[];
	value?: string;
	defaultValue?: string;
	onChange?: (value: string) => void;
	placeholder?: string;
}

export function CustomSelect({
	label,
	options,
	value,
	defaultValue,
	onChange,
	placeholder = "Select an option",
	className,
	...props
}: CustomSelectProps) {
	return (
		<Select
			className={className}
			placeholder={placeholder}
			selectedKey={value ?? null}
			defaultSelectedKey={defaultValue ?? null}
			onSelectionChange={(key) => {
				if (onChange && key !== null) {
					onChange(key as string);
				}
			}}
			{...props}
		>
			{label && <Label>{label}</Label>}
			<Select.Trigger>
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{options.map((opt) => (
						<ListBox.Item key={opt.value} id={opt.value} textValue={opt.label}>
							{opt.label}
							<ListBox.ItemIndicator />
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}

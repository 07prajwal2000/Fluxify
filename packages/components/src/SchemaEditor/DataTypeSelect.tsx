import { ListBox, Select } from "@heroui/react";
import clsx from "clsx";
import type { DataType, DataTypeOption } from "./types";

/**
 * An absolute width, not a flex share: the trigger must not grow with the
 * selected label nor steal room from the key field next to it.
 */
const TRIGGER_WIDTH = 176;

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
			className={clsx("shrink-0 grow-0", className)}
			isDisabled={isDisabled}
			onSelectionChange={(key) => key && onChange(key as DataType)}
			selectedKey={value}
			style={{ width: TRIGGER_WIDTH, minWidth: TRIGGER_WIDTH }}
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

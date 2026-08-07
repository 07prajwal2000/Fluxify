import {
	Chip,
	Description,
	Label,
	ListBox,
	Select,
} from "@heroui/react";
import type { Key } from "react";
import type { MultiSelectOption, MultiSelectProps } from "./types";

/**
 * Dropdown that keeps several options selected at once, shown as chips in the
 * trigger. HeroUI's Select already does multiple selection — this only fixes
 * the shape of the value (a plain `string[]`) and renders the chips.
 */
export function MultiSelect({
	options,
	value,
	onChange,
	label,
	description,
	placeholder = "Select…",
	isDisabled,
	fullWidth = true,
	variant = "secondary",
}: MultiSelectProps) {
	const labelFor = (option: string) =>
		options.find((entry: MultiSelectOption) => entry.value === option)?.label ??
		option;

	return (
		<Select
			selectionMode="multiple"
			fullWidth={fullWidth}
			variant={variant}
			isDisabled={isDisabled}
			placeholder={placeholder}
			value={value}
			onChange={(keys: Key[]) => onChange(keys.map(String))}
		>
			{label && <Label>{label}</Label>}
			<Select.Trigger>
				{/* chips come from `value`, not the collection: one source of truth */}
				<Select.Value>
					{({ isPlaceholder }) =>
						isPlaceholder ? (
							<span className="text-muted-foreground">{placeholder}</span>
						) : (
							<span className="flex flex-wrap items-center gap-1">
								{value.map((entry) => (
									<Chip key={entry} size="sm">
										{labelFor(entry)}
									</Chip>
								))}
							</span>
						)
					}
				</Select.Value>
				<Select.Indicator />
			</Select.Trigger>
			{description && <Description>{description}</Description>}
			<Select.Popover>
				<ListBox>
					{options.map((option) => (
						<ListBox.Item
							key={option.value}
							id={option.value}
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

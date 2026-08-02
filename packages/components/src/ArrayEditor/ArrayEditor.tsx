import { Button, Description, Label } from "@heroui/react";
import clsx from "clsx";
import { useCallback } from "react";
import { TbMinus, TbPlus } from "react-icons/tb";
import { JsTextField } from "../JsTextField";
import type { ArrayEditorProps } from "./types";

export function ArrayEditor({
	label,
	description,
	values,
	array,
	onChange,
	onValueChange,
	onAdd,
	onRemove,
	showAddButton = true,
	addButtonLabel = "Add Item",
	placeholder = "Enter value",
	disableJs = false,
	isDisabled,
	readOnly,
	className,
	emptyMessage = "No items added yet.",
}: ArrayEditorProps) {
	const disabled = Boolean(isDisabled || readOnly);
	const items = values ?? array ?? [];

	const handleItemChange = useCallback(
		(index: number, nextVal: string) => {
			if (onValueChange) {
				onValueChange(index, nextVal);
			}
			if (onChange) {
				const nextList = [...items];
				nextList[index] = nextVal;
				onChange(nextList);
			}
		},
		[items, onChange, onValueChange],
	);

	const handleRemove = useCallback(
		(index: number) => {
			if (onRemove) {
				onRemove(index);
			}
			if (onChange) {
				const nextList = items.filter((_, i) => i !== index);
				onChange(nextList);
			}
		},
		[items, onChange, onRemove],
	);

	const handleAdd = useCallback(() => {
		if (onAdd) {
			onAdd();
		}
		if (onChange) {
			onChange([...items, ""]);
		}
	}, [items, onAdd, onChange]);

	return (
		<div className={clsx("flex flex-col gap-3 w-full", className)}>
			{label && (
				<Label className="text-sm font-medium text-foreground">{label}</Label>
			)}
			{description && (
				<Description className="text-xs text-muted-foreground">
					{description}
				</Description>
			)}

			<div className="flex flex-col gap-2.5 w-full">
				{items.length === 0 ? (
					<p className="text-xs text-muted-foreground py-1">{emptyMessage}</p>
				) : (
					items.map((item, index) => (
						<div
							key={index}
							className="flex flex-row items-center gap-2 w-full"
						>
							<div className="flex-1 min-w-0">
								<JsTextField
									fullWidth
									disableJs={disableJs}
									isDisabled={disabled}
									placeholder={placeholder}
									value={item ?? ""}
									onChange={(val) => handleItemChange(index, val)}
									variant="secondary"
								/>
							</div>

							<div className="h-10 flex items-center justify-center shrink-0">
								<Button
									aria-label={`Remove item ${index + 1}`}
									isIconOnly
									isDisabled={disabled}
									size="sm"
									variant="ghost"
									onPress={() => handleRemove(index)}
								>
									<TbMinus className="text-danger size-4" />
								</Button>
							</div>
						</div>
					))
				)}
			</div>

			{showAddButton && !disabled && (
				<div className="flex flex-col gap-1.5 items-start mt-1">
					<Button
						size="sm"
						variant="secondary"
						isDisabled={disabled}
						onPress={handleAdd}
					>
						<TbPlus className="size-4 mr-1" />
						{addButtonLabel}
					</Button>
				</div>
			)}
		</div>
	);
}

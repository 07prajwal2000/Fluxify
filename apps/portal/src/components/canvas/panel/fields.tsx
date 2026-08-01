import {
	Checkbox,
	Description,
	Input,
	JsTextField,
	Label,
	ListBox,
	Select,
	TextField,
} from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { useCanvasChanges } from "../changes/ChangesContext";
import type { BlockData } from "../types";

export type FieldProps = {
	blockId: string;
	data: BlockData;
	/** Key written into the block's data — the engine reads it by this name. */
	name: string;
	label: string;
	/** Shown under the control. */
	hint?: string;
};

export type SelectOption = { value: string; label: string };

export type BlockSelectFieldProps = FieldProps & {
	options: SelectOption[];
	placeholder?: string;
};

/**
 * A single-choice block setting. Written straight through on change — a select
 * has no half-typed state to debounce, unlike the text fields.
 */
export function BlockSelectField({
	blockId,
	data,
	name,
	label,
	hint,
	options,
	placeholder,
}: BlockSelectFieldProps) {
	const { updateNodeData } = useReactFlow();
	// Tracking disabled means a readonly canvas: show the value, don't edit it.
	const { enabled: editable } = useCanvasChanges();
	const value = typeof data[name] === "string" ? (data[name] as string) : null;

	return (
		<Select
			fullWidth
			variant="secondary"
			isDisabled={!editable}
			placeholder={placeholder}
			value={value}
			onChange={(next) => updateNodeData(blockId, { [name]: String(next) })}
		>
			<Label>{label}</Label>
			<Select.Trigger>
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			{hint && <Description>{hint}</Description>}
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

export type BlockTextFieldProps = FieldProps & {
	placeholder?: string;
};

/**
 * A plain text setting field backed by HeroUI TextField.
 * Keeps local state while typing and commits on blur / enter.
 */
export function BlockTextField({
	blockId,
	data,
	name,
	label,
	hint,
	placeholder,
}: BlockTextFieldProps) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const storedValue = typeof data[name] === "string" ? (data[name] as string) : "";
	const [value, setValue] = useState(storedValue);

	useEffect(() => {
		setValue(storedValue);
	}, [storedValue]);

	const commit = useCallback(() => {
		if (value === storedValue) return;
		updateNodeData(blockId, { [name]: value });
	}, [blockId, data, name, storedValue, updateNodeData, value]);

	const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") event.currentTarget.blur();
	}, []);

	return (
		<TextField
			fullWidth
			variant="secondary"
			isDisabled={!editable}
			value={value}
			onChange={setValue}
		>
			<Label>{label}</Label>
			<Input placeholder={placeholder} onBlur={commit} onKeyDown={onKeyDown} />
			{hint && <Description>{hint}</Description>}
		</TextField>
	);
}

export type BlockJsTextFieldProps = FieldProps & {
	placeholder?: string;
};

/**
 * A block setting field backed by JsTextField from @fluxify/components.
 * Supports plain string input as well as JavaScript expressions (js:...).
 */
export function BlockJsTextField({
	blockId,
	data,
	name,
	label,
	hint,
	placeholder,
}: BlockJsTextFieldProps) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const value = typeof data[name] === "string" ? (data[name] as string) : "";

	return (
		<JsTextField
			fullWidth
			variant="secondary"
			isDisabled={!editable}
			label={label}
			description={hint}
			placeholder={placeholder}
			value={value}
			onChange={(next) => updateNodeData(blockId, { [name]: next })}
		/>
	);
}

export type BlockCheckboxFieldProps = FieldProps & {
	description?: string;
};

/**
 * A boolean setting field backed by custom Checkbox from @fluxify/components.
 */
export function BlockCheckboxField({
	blockId,
	data,
	name,
	label,
	hint,
	description,
}: BlockCheckboxFieldProps) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const checked = Boolean(data[name]);

	return (
		<Checkbox
			checked={checked}
			isDisabled={!editable}
			label={label}
			description={hint ?? description}
			onChange={(next) => updateNodeData(blockId, { [name]: next })}
		/>
	);
}




import { InputGroup, TextField } from "@heroui/react";
import type { ReactNode } from "react";
import { Checkbox } from "../Checkbox";
import { JsTextField } from "../JsTextField";
import { JsonArrayEditor } from "./JsonArrayEditor";
import { JsonObjectEditor } from "./JsonObjectEditor";
import { JsonTypeSelect } from "./JsonTypeSelect";
import type { JsonValue } from "./types";
import { createDefaultJsonValue, getJsonValueType, isCounterValue } from "./utils";

interface JsonValueEditorProps {
	value: JsonValue;
	onChange: (value: JsonValue) => void;
	isReadOnly: boolean;
	allowExpressions: boolean;
	depth: number;
	showTypeSelect?: boolean;
	/** a top-level field of a `counters` editor */
	counters?: boolean;
}

export function JsonValueEditor({
	value,
	onChange,
	isReadOnly,
	allowExpressions,
	depth,
	showTypeSelect = true,
	counters = false,
}: JsonValueEditorProps) {
	const valueType = getJsonValueType(value, counters);

	const typeSelect = (
		<JsonTypeSelect
			className="w-full sm:w-32 sm:shrink-0"
			isDisabled={isReadOnly}
			counters={counters}
			onChange={(nextType) => onChange(createDefaultJsonValue(nextType))}
			value={valueType}
		/>
	);

	if (counters && isCounterValue(value)) {
		return (
			<div className="flex min-w-0 flex-col gap-2 sm:flex-row">
				<div className="min-w-0 flex-1">
					<JsTextField
						fullWidth
						disableJs={!allowExpressions}
						isDisabled={isReadOnly}
						// a number is stored as one; anything else (a js: expression) as text
						onChange={(text) => {
							const amount = Number(text);
							onChange({
								op: value.op,
								value: text.trim() !== "" && Number.isFinite(amount) ? amount : text,
							});
						}}
						placeholder={value.op === "inc" ? "Amount to add" : "Amount to subtract"}
						value={String(value.value)}
					/>
				</div>
				{showTypeSelect && typeSelect}
			</div>
		);
	}

	if (
		valueType === "object" &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		value !== null
	) {
		return (
			<div className="flex min-w-0 flex-col gap-2">
				{showTypeSelect && <div className="flex justify-end">{typeSelect}</div>}
				<JsonObjectEditor
					allowExpressions={allowExpressions}
					depth={depth}
					isReadOnly={isReadOnly}
					onChange={onChange}
					value={value}
				/>
			</div>
		);
	}

	if (valueType === "array" && Array.isArray(value)) {
		return (
			<div className="flex min-w-0 flex-col gap-2">
				{showTypeSelect && <div className="flex justify-end">{typeSelect}</div>}
				<JsonArrayEditor
					allowExpressions={allowExpressions}
					depth={depth}
					isReadOnly={isReadOnly}
					onChange={onChange}
					value={value}
				/>
			</div>
		);
	}

	let field: ReactNode;
	if (valueType === "string" && typeof value === "string") {
		field = allowExpressions ? (
			<JsTextField
				fullWidth
				isDisabled={isReadOnly}
				onChange={onChange}
				placeholder="Value"
				value={value}
			/>
		) : (
			<TextField fullWidth isDisabled={isReadOnly} variant="secondary">
				<InputGroup fullWidth variant="secondary">
					<InputGroup.Input
						aria-label="String value"
						onChange={(event) => onChange(event.currentTarget.value)}
						placeholder="Value"
						value={value}
					/>
				</InputGroup>
			</TextField>
		);
	} else if (valueType === "number" && typeof value === "number") {
		field = (
			<TextField fullWidth isDisabled={isReadOnly} variant="secondary">
				<InputGroup fullWidth variant="secondary">
					<InputGroup.Input
						aria-label="Number value"
						onChange={(event) => {
							const nextValue = Number(event.currentTarget.value);
							if (Number.isFinite(nextValue)) onChange(nextValue);
						}}
						type="number"
						value={String(value)}
					/>
				</InputGroup>
			</TextField>
		);
	} else if (valueType === "boolean" && typeof value === "boolean") {
		field = (
			<div className="flex min-h-10 items-center rounded-[var(--radius)] border border-border bg-surface-secondary px-3">
				<Checkbox
					isDisabled={isReadOnly}
					isSelected={value}
					label={value ? "True" : "False"}
					onChange={onChange}
				/>
			</div>
		);
	} else {
		field = (
			<div className="flex min-h-10 items-center rounded-[var(--radius)] border border-border bg-surface-secondary px-3 font-mono text-xs text-muted">
				null
			</div>
		);
	}

	return (
		<div className="flex min-w-0 flex-col gap-2 sm:flex-row">
			<div className="min-w-0 flex-1">{field}</div>
			{showTypeSelect && typeSelect}
		</div>
	);
}

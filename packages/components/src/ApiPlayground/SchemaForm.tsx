import { Checkbox, Input } from "@heroui/react";
import clsx from "clsx";
import { useEffect, useMemo } from "react";
import { FilePicker } from "./FilePicker";
import type { ApiFormValue, ApiSchema } from "./types";
import { schemaProperties } from "./utils";

type SchemaFormProps = {
	schema?: ApiSchema | null;
	value: Record<string, ApiFormValue>;
	onChange: (value: Record<string, ApiFormValue>) => void;
	errors?: Record<string, string>;
};

export function SchemaForm({ schema, value, onChange, errors }: SchemaFormProps) {
	const fields = useMemo(() => schemaProperties(schema), [schema]);
	useEffect(() => {
		if (!fields.length) return;
		onChange(Object.fromEntries(fields.map((field) => [field.key, value[field.key] ?? ""])));
		// Initialize newly discovered schema fields once, preserving user values.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [schema]);
	if (!fields.length)
		return (
			<p className="py-5 text-center text-xs text-muted">
				This request body has no declared fields.
			</p>
		);
	return (
		<div className="grid grid-cols-2 gap-3">
			{fields.map((field) => {
				const isInvalid = Boolean(errors?.[field.key]);
				const multiple = field.dataType === "arr" && field.items?.dataType === "file";
				const type =
					field.dataType === "bool"
						? "checkbox"
						: field.dataType === "int" || field.dataType === "float"
							? "number"
							: field.dataType === "file" || multiple
								? "file"
								: "text";
				// a label forwards every click inside it to the hidden file input
				const Wrapper = type === "file" ? "div" : "label";
				return (
					<Wrapper className="min-w-0 space-y-1.5" key={field.key}>
						<span className="flex gap-1 font-mono text-[11px] text-muted">
							<span className="truncate">{field.key}</span>
							{field.required && <span className="text-danger">*</span>}
							<span className="ml-auto text-[10px]">
								{multiple ? "file[]" : (field.dataType ?? "str")}
							</span>
						</span>
						{type === "checkbox" ? (
							<Checkbox
								isSelected={value[field.key] === "true"}
								onChange={(selected) => onChange({ ...value, [field.key]: String(selected) })}
							>
								Enabled
							</Checkbox>
						) : type === "file" ? (
							<FilePicker
								aria-label={field.key}
								multiple={multiple}
								isInvalid={isInvalid}
								files={toFiles(value[field.key])}
								onChange={(files) =>
									onChange({
										...value,
										// "" keeps an emptied field reading as missing
										[field.key]: files.length === 0 ? "" : multiple ? files : files[0]!,
									})
								}
							/>
						) : (
							<Input
								aria-invalid={isInvalid}
								type={type}
								value={String(value[field.key] ?? "")}
								onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
								className={clsx(
									"w-full font-mono text-xs",
									isInvalid && "border-danger text-danger",
								)}
							/>
						)}
						{isInvalid && errors && (
							<span className="text-[10px] text-danger block">{errors[field.key]}</span>
						)}
					</Wrapper>
				);
			})}
		</div>
	);
}

function toFiles(value: ApiFormValue | undefined): File[] {
	if (Array.isArray(value)) return value;
	return value instanceof File ? [value] : [];
}

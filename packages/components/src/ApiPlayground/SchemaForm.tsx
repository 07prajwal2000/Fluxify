import { useEffect, useMemo } from "react";
import { Checkbox, Input } from "@heroui/react";
import type { ApiFormValue, ApiSchema } from "./types";
import { schemaProperties } from "./utils";

type SchemaFormProps = {
	schema?: ApiSchema | null;
	value: Record<string, ApiFormValue>;
	onChange: (value: Record<string, ApiFormValue>) => void;
};

export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
	const fields = useMemo(() => schemaProperties(schema), [schema]);
	useEffect(() => {
		if (!fields.length) return;
		onChange(Object.fromEntries(fields.map((field) => [field.key, value[field.key] ?? ""])));
		// Initialize newly discovered schema fields once, preserving user values.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [schema]);
	if (!fields.length) return <p className="py-5 text-center text-xs text-muted">This request body has no declared fields.</p>;
	return <div className="grid grid-cols-2 gap-3">{fields.map((field) => {
		const type = field.dataType === "bool" ? "checkbox" : field.dataType === "int" || field.dataType === "float" ? "number" : field.dataType === "file" ? "file" : "text";
		return <label className="min-w-0 space-y-1.5" key={field.key}>
			<span className="flex gap-1 font-mono text-[11px] text-muted"><span className="truncate">{field.key}</span>{field.required && <span className="text-danger">*</span>}<span className="ml-auto text-[10px]">{field.dataType ?? "str"}</span></span>
			{type === "checkbox" ? <Checkbox isSelected={value[field.key] === "true"} onChange={(selected) => onChange({ ...value, [field.key]: String(selected) })}>Enabled</Checkbox> : <Input type={type} value={type !== "file" ? String(value[field.key] ?? "") : undefined} onChange={(event) => onChange({ ...value, [field.key]: type === "file" ? event.target.files?.[0] ?? "" : event.target.value })} className="w-full font-mono text-xs" />}
		</label>;
	})}</div>;
}

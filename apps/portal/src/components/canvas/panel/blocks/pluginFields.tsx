import {
	ConditionsBuilder,
	Description,
	Input,
	JsonEditor,
	Label,
	SchemaEditor,
	TextField,
	type ValidationSchema,
} from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { useEffect, useState } from "react";
import { useCanvasChanges } from "../../changes/ChangesContext";
import { parseConditionList, serializeIfConditions } from "./ifConditions";

type Props = {
	blockId: string;
	data: Record<string, unknown>;
	name: string;
	label: string;
	hint?: string;
};

/** A number param: kept as text while typed, saved as a number on blur; empty clears it. */
export function PluginNumberField({ blockId, data, name, label, hint }: Props) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const stored = data[name] == null ? "" : String(data[name]);
	const [text, setText] = useState(stored);
	useEffect(() => setText(stored), [stored]);
	const commit = () => {
		const next = text.trim() === "" ? undefined : Number(text);
		if (next !== undefined && Number.isNaN(next)) return setText(stored);
		if (String(next ?? "") !== stored) updateNodeData(blockId, { [name]: next });
	};
	return (
		<TextField fullWidth variant="secondary" isDisabled={!editable} value={text} onChange={setText}>
			<Label>{label}</Label>
			<Input
				inputMode="decimal"
				onBlur={commit}
				onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
			/>
			{hint && <Description>{hint}</Description>}
		</TextField>
	);
}

/** A json param, edited as an object or array. */
export function PluginJsonField({ blockId, data, name, label, hint }: Props) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const value = data[name];
	return (
		<JsonEditor
			label={label}
			description={hint}
			isDisabled={!editable}
			value={typeof value === "object" && value !== null ? (value as never) : undefined}
			onChange={(next) => updateNodeData(blockId, { [name]: next })}
		/>
	);
}

/** A conditions param, stored in the shape the If block saves. */
export function PluginConditionsField({ blockId, data, name, label, hint }: Props) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	return (
		<ConditionsBuilder
			collapsible={false}
			allowGroups
			label={label}
			description={hint}
			isDisabled={!editable}
			conditions={parseConditionList(data[name])}
			onChange={(next) => updateNodeData(blockId, { [name]: serializeIfConditions(next) })}
		/>
	);
}

/** A schema param, stored in Fluxify's schema format; the runtime compiles it. */
export function PluginSchemaField({ blockId, data, name, label, hint }: Props) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const value = data[name];
	return (
		<SchemaEditor
			label={label}
			description={hint}
			isReadOnly={!editable}
			value={typeof value === "object" && value !== null ? (value as ValidationSchema) : undefined}
			onChange={(next) => updateNodeData(blockId, { [name]: next })}
		/>
	);
}

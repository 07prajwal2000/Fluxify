import {
	ArrayEditor,
	Description,
	FieldMapEditor,
	JavaScriptTextArea,
	Label,
} from "@fluxify/components";
import type { ArrayParam, HintParam, KeyValueParam } from "@fluxify/sdk/blocks";
import { useReactFlow } from "@xyflow/react";
import { useState } from "react";
import { MarkdownViewer } from "@/components/ai/MarkdownViewer";
import { useCanvasChanges } from "../../changes/ChangesContext";
import { HeadersEditor } from "./HttpRequestSettings";

type Props = {
	blockId: string;
	data: Record<string, unknown>;
	name: string;
	label: string;
	hint?: string;
};

const asObject = (value: unknown) =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const asText = (value: unknown) =>
	typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);

function Heading({ label, hint }: { label: string; hint?: string }) {
	return (
		<>
			<Label className="text-sm font-medium">{label}</Label>
			{hint && <Description className="text-xs text-muted">{hint}</Description>}
		</>
	);
}

/**
 * A `js` param: code in the multi-line editor, saved as `js:<code>` so the
 * runtime evaluates it like any `js:` value and `run` gets the result.
 */
export function PluginJsField({ blockId, data, name, label, hint }: Props) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const code = asText(data[name]).replace(/^js:/, "");
	return (
		<div className="flex flex-col gap-1.5">
			<Heading label={label} hint={hint} />
			<JavaScriptTextArea
				aria-label={label}
				expandable
				expandTitle={`${label} - Code Editor`}
				rows={5}
				showLineNumbers
				readOnly={!editable}
				value={code}
				onChange={(next) =>
					updateNodeData(blockId, { [name]: next.trim() ? `js:${next}` : undefined })
				}
			/>
		</div>
	);
}

/** A `keyValue` param: key rows, each value a literal or `js:`; a missing or repeated key is refused. */
export function PluginKeyValueField({
	blockId,
	data,
	name,
	label,
	hint,
	param,
}: Props & { param: KeyValueParam }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const rows = Object.fromEntries(
		Object.entries(asObject(data[name] ?? param.default)).map(([k, v]) => [k, asText(v)]),
	);
	return (
		<div className="flex flex-col gap-1.5">
			<Heading label={label} hint={hint} />
			<HeadersEditor
				headers={rows}
				editable={editable}
				noun="Row"
				keyPlaceholder={param.keys?.placeholder ?? "Key"}
				strictKeys
				onChange={(next) => updateNodeData(blockId, { [name]: next })}
			/>
		</div>
	);
}

/** An `array` param: items each a literal or `js:`, held between `min` and `max`. */
export function PluginArrayField({
	blockId,
	data,
	name,
	label,
	hint,
	param,
}: Props & { param: ArrayParam }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const stored = data[name] ?? param.default;
	const values = Array.isArray(stored) ? stored.map(asText) : [];
	const [problem, setProblem] = useState<string>();
	const save = (next: string[]) => {
		const wrong =
			param.min !== undefined && next.length < param.min
				? `Needs at least ${param.min}.`
				: param.max !== undefined && next.length > param.max
					? `Takes at most ${param.max}.`
					: undefined;
		setProblem(wrong);
		// still saved: the list is half-edited, and the runtime refuses it until it is fixed
		updateNodeData(blockId, { [name]: next });
	};
	return (
		<div className="flex flex-col gap-1.5">
			<ArrayEditor
				label={label}
				description={hint}
				addButtonLabel={`Add ${param.of ?? "item"}`}
				placeholder={param.of}
				isDisabled={!editable}
				readOnly={!editable}
				values={values}
				onChange={save}
			/>
			{problem && (
				<p role="alert" className="text-xs text-danger">
					{problem}
				</p>
			)}
		</div>
	);
}

/** A `fieldMap` param: source key → destination key, as the Transformer block maps. */
export function PluginFieldMapField({ blockId, data, name, label, hint }: Props) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	return (
		<FieldMapEditor
			isDisabled={!editable}
			fieldMap={asObject(data[name]) as Record<string, string>}
			label={label}
			description={hint ?? "Map source fields to destination object keys"}
			onKeyValueChange={(next) => updateNodeData(blockId, { [name]: next })}
		/>
	);
}

/** A hint: markdown in the docs' callout, between the params of its tab. */
export function PluginHint({ hint }: { hint: HintParam }) {
	return <MarkdownViewer content={`:::${hint.tone ?? "info"}\n${hint.text}\n:::`} />;
}

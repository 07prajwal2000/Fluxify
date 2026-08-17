import { useCallback, useId } from "react";
import {
	ArrayEditor,
	Button,
	CustomSelect,
	DeleteIconButton,
	Input,
	Label,
	TextField,
} from "@fluxify/components";
import { TbPlus } from "react-icons/tb";
import type { CustomBlockInputParam } from "@/components/canvas/panel/blocks/CustomBlockSettings";

const PARAM_TYPE_OPTIONS = [
	{ value: "text_input", label: "Text input" },
	{ value: "checkbox", label: "Checkbox" },
	{ value: "dropdown", label: "Dropdown" },
	{ value: "array_editor", label: "Array editor" },
	{ value: "integration_selector", label: "Integration selector" },
];

const NAME_REGEX = /^[a-z0-9_]+$/;

function emptyParam(
	type: CustomBlockInputParam["type"],
): CustomBlockInputParam {
	const base = { name: "", label: "", type, description: "" };
	if (type === "dropdown") return { ...base, options: [] };
	if (type === "integration_selector") return { ...base, group: "", tags: [] };
	return base;
}

export function validateInputParams(
	params: CustomBlockInputParam[],
): string | null {
	const seen = new Set<string>();
	for (const p of params) {
		if (!p.name.trim() || !NAME_REGEX.test(p.name)) {
			return `"${p.label || p.name || "unnamed"}": name must be lowercase letters, digits, underscores.`;
		}
		if (seen.has(p.name)) return `Duplicate parameter name "${p.name}".`;
		seen.add(p.name);
		if (!p.label.trim()) return `"${p.name}": label is required.`;
		if (p.type === "dropdown") {
			const options = p.options ?? [];
			if (options.length === 0) return `"${p.name}": add at least one option.`;
			for (const opt of options) {
				const value = typeof opt === "string" ? opt : opt.value;
				if (!value?.trim()) return `"${p.name}": option values can't be empty.`;
			}
		}
		if (p.type === "integration_selector" && !p.group?.trim()) {
			return `"${p.name}": integration group is required.`;
		}
	}
	return null;
}

export function InputParamsEditor({
	params,
	onChange,
	isDisabled,
}: {
	params: CustomBlockInputParam[];
	onChange: (next: CustomBlockInputParam[]) => void;
	isDisabled?: boolean;
}) {
	const update = useCallback(
		(index: number, patch: Partial<CustomBlockInputParam>) => {
			onChange(params.map((p, i) => (i === index ? { ...p, ...patch } : p)));
		},
		[params, onChange],
	);

	const remove = useCallback(
		(index: number) => onChange(params.filter((_, i) => i !== index)),
		[params, onChange],
	);

	const sampleName =
		params.find((p) => p.name.trim())?.name.trim() ?? "channel";

	const add = useCallback(
		() => onChange([...params, emptyParam("text_input")]),
		[params, onChange],
	);

	return (
		<div className="flex flex-col gap-3 w-full">
			{/* `params` is bound alongside `input` in every JS expression of a
			    custom block's graph — see compiler.ts `js()` */}
			<p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-muted">
				In this block's JavaScript, read these as{" "}
				<code className="font-mono text-accent">params.{sampleName}</code> —
				available in every block of the canvas, not just the first.{" "}
				<code className="font-mono text-accent">input</code> stays what it is
				everywhere else: the previous block's output, or whatever the caller
				passed in at the entrypoint.
			</p>
			{params.length === 0 ? (
				<div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted">
					No input parameters yet. Add one so this block can be configured when
					placed on a route.
				</div>
			) : (
				params.map((param, index) => (
					<ParamRow
						key={index}
						param={param}
						isDisabled={isDisabled}
						onChange={(patch) => update(index, patch)}
						onRemove={() => remove(index)}
					/>
				))
			)}

			{!isDisabled && (
				<Button
					size="sm"
					variant="secondary"
					className="self-start"
					onPress={add}
				>
					<TbPlus className="size-4 mr-1" /> Add parameter
				</Button>
			)}
		</div>
	);
}

function ParamRow({
	param,
	isDisabled,
	onChange,
	onRemove,
}: {
	param: CustomBlockInputParam;
	isDisabled?: boolean;
	onChange: (patch: Partial<CustomBlockInputParam>) => void;
	onRemove: () => void;
}) {
	const id = useId();

	function changeType(type: string) {
		const next = emptyParam(type as CustomBlockInputParam["type"]);
		onChange({
			...next,
			name: param.name,
			label: param.label,
			description: param.description,
		});
	}

	return (
		<div className="flex flex-col gap-3 rounded-md border border-border p-3">
			<div className="flex items-start gap-2">
				<TextField
					fullWidth
					isDisabled={isDisabled}
					value={param.name}
					onChange={(name) => onChange({ name })}
				>
					<Label>Name</Label>
					<Input placeholder="webhook_url" className="font-mono" />
				</TextField>
				<TextField
					fullWidth
					isDisabled={isDisabled}
					value={param.label}
					onChange={(label) => onChange({ label })}
				>
					<Label>Label</Label>
					<Input placeholder="Webhook URL" />
				</TextField>
				<div className="flex flex-col gap-1.5 w-56 shrink-0">
					<CustomSelect
						label="Type"
						isDisabled={isDisabled}
						options={PARAM_TYPE_OPTIONS}
						value={param.type}
						onChange={changeType}
					/>
				</div>
				<DeleteIconButton
					aria-label="Remove parameter"
					className="mt-6"
					isDisabled={isDisabled}
					onPress={onRemove}
				/>
			</div>

			<TextField
				fullWidth
				isDisabled={isDisabled}
				value={param.description ?? ""}
				onChange={(description) => onChange({ description })}
			>
				<Label>Description</Label>
				<Input placeholder="Shown as a hint under the field" />
			</TextField>

			{param.type === "dropdown" && (
				<DropdownOptionsEditor
					id={id}
					options={param.options ?? []}
					isDisabled={isDisabled}
					onChange={(options) => onChange({ options })}
				/>
			)}

			{param.type === "integration_selector" && (
				<div className="flex flex-col gap-3">
					<TextField
						fullWidth
						isDisabled={isDisabled}
						value={param.group ?? ""}
						onChange={(group) => onChange({ group })}
					>
						<Label>Integration group</Label>
						<Input placeholder="database" />
					</TextField>
					<ArrayEditor
						label="Tags"
						description="Optional. Narrows the integration picker further."
						disableJs
						isDisabled={isDisabled}
						values={param.tags ?? []}
						onChange={(tags) => onChange({ tags })}
						addButtonLabel="Add tag"
						placeholder="e.g. postgres"
					/>
				</div>
			)}
		</div>
	);
}

function DropdownOptionsEditor({
	id,
	options,
	isDisabled,
	onChange,
}: {
	id: string;
	options: (string | { label: string; value: string })[];
	isDisabled?: boolean;
	onChange: (next: { label: string; value: string }[]) => void;
}) {
	const normalized = options.map((o) =>
		typeof o === "string" ? { label: o, value: o } : o,
	);

	function update(
		index: number,
		patch: Partial<{ label: string; value: string }>,
	) {
		onChange(normalized.map((o, i) => (i === index ? { ...o, ...patch } : o)));
	}

	function remove(index: number) {
		onChange(normalized.filter((_, i) => i !== index));
	}

	return (
		<div className="flex flex-col gap-2">
			<Label className="text-sm font-medium">Options</Label>
			{normalized.length === 0 && (
				<p className="text-xs text-muted">No options added yet.</p>
			)}
			{normalized.map((opt, index) => (
				<div key={`${id}-${index}`} className="flex items-center gap-2">
					<TextField
						fullWidth
						isDisabled={isDisabled}
						value={opt.label}
						onChange={(label) => update(index, { label })}
					>
						<Input placeholder="Label" />
					</TextField>
					<TextField
						fullWidth
						isDisabled={isDisabled}
						value={opt.value}
						onChange={(value) => update(index, { value })}
					>
						<Input placeholder="Value" />
					</TextField>
					<DeleteIconButton
						aria-label="Remove option"
						isDisabled={isDisabled}
						onPress={() => remove(index)}
					/>
				</div>
			))}
			{!isDisabled && (
				<Button
					size="sm"
					variant="secondary"
					className="self-start"
					onPress={() => onChange([...normalized, { label: "", value: "" }])}
				>
					<TbPlus className="size-4 mr-1" /> Add option
				</Button>
			)}
		</div>
	);
}

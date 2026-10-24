import {
	ArrayEditor,
	Autocomplete,
	Checkbox,
	Description,
	type FieldInfo,
	FieldInfoButton,
	Input,
	JsTextField,
	type JsTextFieldSuggestion,
	Label,
	ListBox,
	SearchField,
	TextField,
	useFilter,
} from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppConfigField } from "@/components/appConfig/AppConfigField";
import type { AppConfigExtraItem } from "@/components/integrations/AppConfigSelectorModal";
import { WorkflowField } from "@/components/workflows/WorkflowField";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { useCanvasChanges } from "../changes/ChangesContext";
import type { BlockData } from "../types";
import type { CustomBlockInputParam } from "./blocks/CustomBlockSettings";
import { toNumberIfNumeric, useDraftText } from "./useDraftText";

export { BlockIntegrationField, type BlockIntegrationFieldProps } from "./integrationField";

export type FieldProps = {
	blockId: string;
	data: BlockData;
	/** Key written into the block's data — the engine reads it by this name. */
	name: string;
	label: string;
	/** Shown under the control. */
	hint?: ReactNode;
};

export type SelectOption = { value: string; label: string };

export type BlockSelectFieldProps = FieldProps & {
	options: SelectOption[];
	placeholder?: string;
	/** Help behind an info button beside the label, instead of a long hint. */
	info?: FieldInfo;
};

/**
 * A single-choice block setting, searchable by its labels. Written straight
 * through on change — a select has no half-typed state to debounce, unlike the
 * text fields.
 */
export function BlockSelectField({
	blockId,
	data,
	name,
	label,
	hint,
	options,
	placeholder,
	info,
}: BlockSelectFieldProps) {
	const { updateNodeData } = useReactFlow();
	// Tracking disabled means a readonly canvas: show the value, don't edit it.
	const { enabled: editable } = useCanvasChanges();
	const { contains } = useFilter({ sensitivity: "base" });
	// a saved graph may hand a numeric setting back as a number
	const raw = data[name];
	const value = raw === undefined || raw === null ? null : String(raw);

	const select = (
		<Autocomplete
			fullWidth
			variant="secondary"
			isDisabled={!editable}
			placeholder={placeholder}
			value={value}
			aria-label={info ? label : undefined}
			onChange={(next) => next != null && updateNodeData(blockId, { [name]: String(next) })}
		>
			{!info && <Label>{label}</Label>}
			<Autocomplete.Trigger>
				<Autocomplete.Value />
				<Autocomplete.Indicator />
			</Autocomplete.Trigger>
			{hint && <Description>{hint}</Description>}
			<Autocomplete.Popover>
				<Autocomplete.Filter filter={contains}>
					<SearchField autoFocus aria-label={`Search ${label}`} variant="secondary">
						<SearchField.Group>
							<SearchField.SearchIcon />
							<SearchField.Input placeholder="Search..." />
						</SearchField.Group>
					</SearchField>
					<ListBox>
						{options.map((option) => (
							<ListBox.Item key={option.value} id={option.value} textValue={option.label}>
								{option.label}
								<ListBox.ItemIndicator />
							</ListBox.Item>
						))}
					</ListBox>
				</Autocomplete.Filter>
			</Autocomplete.Popover>
		</Autocomplete>
	);
	if (!info) return select;
	// outside the Autocomplete: a press on its label or the info button would open the list
	return (
		<div className="flex flex-col gap-1 w-full">
			<div className="flex items-center gap-1">
				<Label>{label}</Label>
				<FieldInfoButton label={label} info={info} />
			</div>
			{select}
		</div>
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
	// a number set by the AI builder or the API shows as text too
	const storedValue = data[name] == null ? "" : String(data[name]);
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
	disableJs?: boolean;
	suggestions?: JsTextFieldSuggestion[];
	/** Help behind an info button beside the label, instead of a long hint. */
	info?: FieldInfo;
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
	disableJs,
	suggestions,
	info,
}: BlockJsTextFieldProps) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const [value, onChange] = useDraftText(
		data[name],
		(val) => updateNodeData(blockId, { [name]: val }),
		toNumberIfNumeric,
	);

	return (
		<JsTextField
			fullWidth
			variant="secondary"
			isDisabled={!editable}
			label={label}
			description={hint}
			info={info}
			placeholder={placeholder}
			value={value}
			disableJs={disableJs}
			suggestions={suggestions}
			onChange={onChange}
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

/**
 * The app config counterpart of `useCustomBlockParamIntegrations`: on a custom
 * block's own canvas, that block's `app_config_selector` input params are
 * offered next to the project's real keys. Picking one writes `param:<name>`,
 * so the key is chosen by whoever places the block — and it chains, an authz
 * block can hand its own secret key down to the jwt block it calls.
 */
function useCustomBlockParamConfigs(
	projectId: string,
	customBlockId: string | undefined,
): AppConfigExtraItem[] | undefined {
	const { data: blocks } = customBlocksQuery.getAll.useQuery(projectId);

	return useMemo(() => {
		if (!customBlockId) return undefined;
		const block = blocks?.find((b) => b.id === customBlockId);
		const params = Array.isArray(block?.inputParams)
			? (block.inputParams as CustomBlockInputParam[])
			: [];
		const matching = params.filter((p) => p.type === "app_config_selector");
		if (matching.length === 0) return undefined;
		return matching.map((param) => ({
			value: `param:${param.name}`,
			label: param.label || param.name,
			hint: `Set by whoever places this block — the “${param.label || param.name}” input.`,
		}));
	}, [blocks, customBlockId]);
}

export type BlockAppConfigFieldProps = {
	blockId: string;
	data: BlockData;
	name: string;
	label?: string;
	description?: string;
};

/**
 * An app config key setting field backed by AppConfigField.
 */
export function BlockAppConfigField({
	blockId,
	data,
	name,
	label,
	description,
}: BlockAppConfigFieldProps) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const params = useParams({ strict: false }) as {
		projectId?: string;
		blockId?: string;
	};
	const projectId = params?.projectId ?? "";
	const value = typeof data[name] === "string" ? (data[name] as string) : "";
	const extraItems = useCustomBlockParamConfigs(projectId, params?.blockId);

	return (
		<AppConfigField
			projectId={projectId}
			value={value}
			label={label}
			description={description}
			isDisabled={!editable}
			extraItems={extraItems}
			onChange={(next) => updateNodeData(blockId, { [name]: next })}
		/>
	);
}

export type BlockWorkflowFieldProps = {
	blockId: string;
	data: BlockData;
	name: string;
	label?: string;
	description?: string;
};

/** A workflow reference block setting, backed by `WorkflowField`. */
export function BlockWorkflowField({
	blockId,
	data,
	name,
	label,
	description,
}: BlockWorkflowFieldProps) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const params = useParams({ strict: false }) as { projectId?: string };
	const value = typeof data[name] === "string" ? (data[name] as string) : "";

	return (
		<WorkflowField
			projectId={params?.projectId ?? ""}
			value={value}
			label={label}
			description={description}
			isDisabled={!editable}
			onChange={(next) => updateNodeData(blockId, { [name]: next })}
		/>
	);
}

export type BlockArrayEditorFieldProps = {
	blockId: string;
	data: BlockData;
	name: string;
	label?: ReactNode;
	description?: ReactNode;
	placeholder?: string;
	addButtonLabel?: string;
	disableJs?: boolean;
	emptyMessage?: string;
	suggestions?: string[];
};

/**
 * An array setting field backed by ArrayEditor.
 */
export function BlockArrayEditorField({
	blockId,
	data,
	name,
	label,
	description,
	placeholder,
	addButtonLabel,
	disableJs,
	emptyMessage,
	suggestions,
}: BlockArrayEditorFieldProps) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const values = Array.isArray(data[name]) ? (data[name] as string[]) : [];

	return (
		<ArrayEditor
			label={label}
			description={description}
			placeholder={placeholder}
			addButtonLabel={addButtonLabel}
			disableJs={disableJs}
			emptyMessage={emptyMessage}
			isDisabled={!editable}
			values={values}
			suggestions={suggestions}
			onChange={(next) => updateNodeData(blockId, { [name]: next })}
		/>
	);
}

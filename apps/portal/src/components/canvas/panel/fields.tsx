import {
	ArrayEditor,
	Checkbox,
	Description,
	Input,
	IntegrationSelector,
	JoinsEditor,
	type JoinItem,
	JsTextField,
	Label,
	ListBox,
	Select,
	TextField,
} from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { withBasePath } from "@/constants/routes";
import { integrationService } from "@/services/integrations";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import type { CustomBlockInputParam } from "./blocks/CustomBlockSettings";
import { useCanvasChanges } from "../changes/ChangesContext";
import type { BlockData } from "../types";

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
	disableJs?: boolean;
	suggestions?: string[];
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
}: BlockJsTextFieldProps) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const rawValue = data[name];
	const value =
		typeof rawValue === "string"
			? rawValue
			: typeof rawValue === "object" && rawValue !== null
				? JSON.stringify(rawValue)
				: rawValue != null
					? String(rawValue)
					: "";

	return (
		<JsTextField
			fullWidth
			variant="secondary"
			isDisabled={!editable}
			label={label}
			description={hint}
			placeholder={placeholder}
			value={value}
			disableJs={disableJs}
			suggestions={suggestions}
			onChange={(next) => {
				const trimmed = next.trim();
				const num = Number(trimmed);
				const val =
					trimmed !== "" && !isNaN(num) && !trimmed.startsWith("js:")
						? num
						: next;
				updateNodeData(blockId, { [name]: val });
			}}
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
 * On a custom block's canvas, the block's own `integration_selector` input
 * parameters are offered alongside the project's integrations. Picking one
 * writes `param:<name>`, which the engine substitutes with whatever the calling
 * block was configured with — so the concrete integration is chosen on the
 * caller's side, not here. `blockId` is only present on the custom block route,
 * which is what keeps this out of route canvases.
 */
function useCustomBlockParamIntegrations(
	projectId: string,
	customBlockId: string | undefined,
	group: string,
) {
	const { data: blocks } = customBlocksQuery.getAll.useQuery(projectId);

	return useMemo(() => {
		if (!customBlockId) return undefined;
		const block = blocks?.find((b) => b.id === customBlockId);
		const params = Array.isArray(block?.inputParams)
			? (block.inputParams as CustomBlockInputParam[])
			: [];
		const matching = params.filter(
			(param) => param.type === "integration_selector" && param.group === group,
		);
		if (matching.length === 0) return undefined;
		return matching.map((param) => ({
			id: `param:${param.name}`,
			name: param.label || param.name,
			group,
			variant: "Input parameter",
			config: {},
			external: true,
			hint: `Set by whoever places this block — the “${param.label || param.name}” input.`,
		}));
	}, [blocks, customBlockId, group]);
}

export type BlockIntegrationFieldProps = {
	blockId: string;
	data: BlockData;
	name: string;
	group?: string;
	label?: ReactNode;
	description?: string;
};

/**
 * An integration selector block setting field backed by IntegrationSelector.
 */
export function BlockIntegrationField({
	blockId,
	data,
	name,
	group = "database",
	label,
	description,
}: BlockIntegrationFieldProps) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const params = useParams({ strict: false }) as {
		projectId?: string;
		blockId?: string;
	};
	const projectId = params?.projectId ?? "";
	const selectedId = typeof data[name] === "string" ? (data[name] as string) : "";
	const injectedIntegrations = useCustomBlockParamIntegrations(
		projectId,
		params?.blockId,
		group,
	);

	const loadIntegrations = useCallback(async () => {
		if (!projectId) return [];
		const list = await integrationService.getAll(projectId, group);
		return (list || []).map((item) => ({
			id: item.id,
			name: item.name,
			group: item.group,
			variant: item.variant,
			config: (item.config ?? {}) as Record<string, unknown>,
			tags: item.tags,
		}));
	}, [projectId, group]);

	const handleTestConnection = useCallback(
		async (id: string) => {
			if (!projectId || !id) return;
			await integrationService.testExistingConnection(projectId, id);
		},
		[projectId],
	);

	const groupParam = group ? `group=${encodeURIComponent(group)}` : "";
	const openParam = selectedId ? `open=${encodeURIComponent(selectedId)}` : "";
	const searchParams = [groupParam, openParam].filter(Boolean).join("&");
	const searchStr = searchParams ? `?${searchParams}` : "";

	return (
		<IntegrationSelector
			label={label}
			description={description}
			group={group}
			selectedId={selectedId}
			loadIntegrations={loadIntegrations}
			injectedIntegrations={injectedIntegrations}
			onSelect={(id) => {
				if (!editable) return;
				updateNodeData(blockId, { [name]: id });
			}}
			onTestConnection={projectId ? handleTestConnection : undefined}
			openInNewTabUrl={
				projectId
					? withBasePath(`/${projectId}/integrations${searchStr}`)
					: undefined
			}
			createIntegrationUrl={
				projectId
					? withBasePath(
							`/${projectId}/integrations${group ? `?group=${encodeURIComponent(group)}` : ""}`,
						)
					: undefined
			}
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

export type BlockJoinsEditorFieldProps = {
	blockId: string;
	data: BlockData;
	name: string;
	label?: ReactNode;
	description?: ReactNode;
	emptyMessage?: string;
	tableSuggestions?: string[];
	columnSuggestions?: string[];
	getColumnSuggestions?: (tableName?: string) => string[];
};

/**
 * A joins setting field backed by JoinsEditor.
 */
export function BlockJoinsEditorField({
	blockId,
	data,
	name,
	label,
	description,
	emptyMessage,
	tableSuggestions,
	columnSuggestions,
	getColumnSuggestions,
}: BlockJoinsEditorFieldProps) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const joins = Array.isArray(data[name]) ? (data[name] as JoinItem[]) : [];

	return (
		<JoinsEditor
			label={label}
			description={description}
			emptyMessage={emptyMessage}
			isDisabled={!editable}
			joins={joins}
			tableSuggestions={tableSuggestions}
			columnSuggestions={columnSuggestions}
			getColumnSuggestions={getColumnSuggestions}
			onChange={(next) => updateNodeData(blockId, { [name]: next })}
		/>
	);
}





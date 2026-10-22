import { Button, CloseButton, cn, Label, Tabs } from "@fluxify/components";
import { isVisible, paramTabs } from "@fluxify/sdk";
import type { HintParam, Param } from "@fluxify/sdk/blocks";
import { ReactFlowProvider, useNodes, useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TbKey } from "react-icons/tb";
import { CanvasChangesProvider, DISABLED_CHANGES } from "../canvas/changes/ChangesContext";
import {
	PluginArrayField,
	PluginFieldMapField,
	PluginHint,
	PluginJsField,
	PluginKeyValueField,
} from "../canvas/panel/blocks/pluginEditorFields";
import {
	PluginConditionsField,
	PluginJsonField,
	PluginNumberField,
	PluginSchemaField,
} from "../canvas/panel/blocks/pluginFields";
import {
	BlockAppConfigField,
	BlockCheckboxField,
	BlockIntegrationField,
	BlockJsTextField,
	BlockSelectField,
} from "../canvas/panel/fields";
import type { BlockNode } from "../canvas/types";
import { AppConfigSelectorModal } from "./AppConfigSelectorModal";

type ValueParam = Exclude<Param, HintParam>;

export function IntegrationSecretField({
	projectId,
	name,
	label,
	hint,
	value,
	onChange,
	isDisabled,
}: {
	projectId: string;
	name: string;
	label: string;
	hint?: string;
	value: string;
	onChange: (v: string) => void;
	isDisabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const isConfig = value.startsWith("cfg:");
	const keyName = isConfig ? value.slice(4) : value;

	return (
		<div className="flex w-full flex-col gap-1.5" data-testid={`secret-field-${name}`}>
			<Label>{label}</Label>
			{hint && <span className="text-xs text-muted">{hint}</span>}
			<div
				className={cn(
					"flex h-10 items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 shadow-sm",
					isConfig && "border-accent/40",
					isDisabled && "opacity-60 cursor-not-allowed",
				)}
			>
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<TbKey size={16} className={cn("shrink-0", isConfig ? "text-accent" : "text-muted")} />
					{value ? (
						<span className="truncate font-mono text-xs font-medium text-foreground">{value}</span>
					) : (
						<span className="text-xs text-muted">Select an app config key...</span>
					)}
				</div>
				<div className="flex items-center gap-1.5">
					{value && !isDisabled && (
						<CloseButton aria-label="Clear secret" onPress={() => onChange("")} />
					)}
					<Button variant="outline" size="sm" isDisabled={isDisabled} onPress={() => setOpen(true)}>
						Pick Key
					</Button>
				</div>
			</div>
			<AppConfigSelectorModal
				projectId={projectId}
				isOpen={open}
				onOpenChange={setOpen}
				selectedValue={keyName}
				onSelect={(k) => onChange(`cfg:${k}`)}
				onClear={() => onChange("")}
			/>
		</div>
	);
}

function ParamField({
	block,
	name,
	param,
	projectId,
	setField,
	readOnly,
}: {
	block: BlockNode;
	name: string;
	param: ValueParam | (Param & { type: "secret" });
	projectId: string;
	setField: (name: string, value: unknown) => void;
	readOnly?: boolean;
}) {
	const hint =
		[param.description, (param as any).deprecated && `Deprecated: ${(param as any).deprecated}`]
			.filter(Boolean)
			.join(" ") || undefined;
	const label = (param.label ?? name) + (param.required ? " *" : "");
	const shared = { blockId: block.id, data: block.data, name, label, hint };

	if (param.type === "secret") {
		return (
			<IntegrationSecretField
				projectId={projectId}
				name={name}
				label={label}
				hint={hint}
				value={String(block.data[name] ?? "")}
				onChange={(val) => setField(name, val)}
				isDisabled={readOnly}
			/>
		);
	}

	switch (param.type) {
		case "string":
			return <BlockJsTextField {...shared} placeholder={param.default} />;
		case "number":
			return <PluginNumberField {...shared} />;
		case "boolean":
			return <BlockCheckboxField {...shared} />;
		case "select":
			return (
				<BlockSelectField
					{...shared}
					options={param.options.map((v) => ({ value: v, label: v }))}
					placeholder={param.default}
				/>
			);
		case "js":
			return <PluginJsField {...shared} />;
		case "json":
			return <PluginJsonField {...shared} />;
		case "integration":
			return (
				<BlockIntegrationField
					blockId={block.id}
					data={block.data}
					name={name}
					group={param.kind}
					label={label}
					description={hint}
				/>
			);
		case "appconfig":
			return (
				<BlockAppConfigField
					blockId={block.id}
					data={block.data}
					name={name}
					label={label}
					description={hint}
				/>
			);
		case "conditions":
			return <PluginConditionsField {...shared} />;
		case "schema":
			return <PluginSchemaField {...shared} />;
		case "keyValue":
			return <PluginKeyValueField {...shared} param={param} />;
		case "array":
			return <PluginArrayField {...shared} param={param} />;
		case "fieldMap":
			return <PluginFieldMapField {...shared} />;
	}
}

function Item({
	block,
	name,
	param,
	projectId,
	setField,
	readOnly,
}: {
	block: BlockNode;
	name: string;
	param: Param;
	projectId: string;
	setField: (name: string, value: unknown) => void;
	readOnly?: boolean;
}) {
	return param.type === "hint" ? (
		<PluginHint hint={param} />
	) : (
		<ParamField
			block={block}
			name={name}
			param={param as any}
			projectId={projectId}
			setField={setField}
			readOnly={readOnly}
		/>
	);
}

function visibleTabs(
	params: Record<string, Param>,
	tabs: readonly string[] | undefined,
	data: Record<string, unknown>,
) {
	const values: Record<string, unknown> = {};
	for (const [name, p] of Object.entries(params)) if ("default" in p) values[name] = p.default;
	for (const [name, value] of Object.entries(data)) if (value != null) values[name] = value;
	const shown = (name: string) => {
		const when = params[name]!.visibleWhen;
		return !when || isVisible(when, values);
	};
	return paramTabs(params, tabs as string[])
		.map((tab) => ({ name: tab.name, items: tab.params.filter(shown) }))
		.filter((tab) => tab.items.some((name) => params[name]!.type !== "hint"));
}

function NodeBridge({
	config,
	setField,
}: {
	config: Record<string, unknown>;
	setField: (name: string, value: unknown) => void;
}) {
	const nodes = useNodes();
	const { updateNodeData } = useReactFlow();
	const prevDataRef = useRef<Record<string, unknown>>(config);
	const nodeData = nodes[0]?.data;

	// When ReactFlow nodeData changes, propagate to setField
	useEffect(() => {
		if (!nodeData) return;
		for (const [key, value] of Object.entries(nodeData)) {
			if (prevDataRef.current[key] !== value) {
				prevDataRef.current = { ...prevDataRef.current, [key]: value };
				setField(key, value);
			}
		}
	}, [nodeData, setField]);

	// When parent config changes externally, sync back to nodeData
	useEffect(() => {
		prevDataRef.current = config;
		updateNodeData("integration-form-node", config);
	}, [config, updateNodeData]);

	return null;
}

export type PluginIntegrationFormProps = {
	projectId: string;
	variant: string;
	params: Record<string, Param>;
	tabs?: readonly string[];
	config: Record<string, unknown>;
	setField: (name: string, value: unknown) => void;
	readOnly?: boolean;
};

export function PluginIntegrationFormInner({
	projectId,
	variant,
	params,
	tabs: declaredTabs,
	config,
	setField,
	readOnly,
}: PluginIntegrationFormProps) {
	const [picked, setPicked] = useState<string>();
	const block: BlockNode = useMemo(
		() => ({
			id: "integration-form-node",
			type: variant,
			position: { x: 0, y: 0 },
			data: config,
		}),
		[variant, config],
	);

	const tabs = visibleTabs(params, declaredTabs, config);
	if (tabs.length === 0)
		return <p className="text-xs text-muted">This connector has no configurable parameters.</p>;

	const selected = tabs.find((t) => t.name === picked)?.name ?? tabs[0]!.name;
	if (picked !== undefined && picked !== selected) setPicked(undefined);

	const panel = (items: string[]) => (
		<div className="flex w-full flex-col gap-4">
			{items.map((name) => (
				<Item
					key={name}
					block={block}
					name={name}
					param={params[name]!}
					projectId={projectId}
					setField={setField}
					readOnly={readOnly}
				/>
			))}
		</div>
	);

	return (
		<>
			<NodeBridge config={config} setField={setField} />
			{tabs.length === 1 ? (
				panel(tabs[0]!.items)
			) : (
				<Tabs
					selectedKey={selected}
					onSelectionChange={(key) => setPicked(String(key))}
					variant="secondary"
				>
					<Tabs.ListContainer>
						<Tabs.List aria-label="Integration parameter tabs">
							{tabs.map((tab) => (
								<Tabs.Tab key={tab.name} id={tab.name}>
									{tab.name}
									<Tabs.Indicator />
								</Tabs.Tab>
							))}
						</Tabs.List>
					</Tabs.ListContainer>
					{tabs.map((tab) => (
						<Tabs.Panel key={tab.name} id={tab.name} className="pt-3">
							{panel(tab.items)}
						</Tabs.Panel>
					))}
				</Tabs>
			)}
		</>
	);
}

export function PluginIntegrationForm(props: PluginIntegrationFormProps) {
	const initialNodes = useMemo<BlockNode[]>(
		() => [
			{
				id: "integration-form-node",
				type: props.variant,
				position: { x: 0, y: 0 },
				data: props.config,
			},
		],
		[props.variant],
	);

	return (
		<CanvasChangesProvider value={{ ...DISABLED_CHANGES, enabled: !props.readOnly }}>
			<ReactFlowProvider defaultNodes={initialNodes}>
				<PluginIntegrationFormInner {...props} />
			</ReactFlowProvider>
		</CanvasChangesProvider>
	);
}

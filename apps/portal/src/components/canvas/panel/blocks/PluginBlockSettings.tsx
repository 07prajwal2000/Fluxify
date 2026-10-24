import { Spinner, Tabs } from "@fluxify/components";
import { isVisible, paramTabs } from "@fluxify/sdk";
import type { HintParam, Param } from "@fluxify/sdk/blocks";
import { useState } from "react";
import { TbAlertTriangle } from "react-icons/tb";
import { usePluginBlocks } from "../../plugins/PluginBlocksContext";
import { isPluginType } from "../../plugins/pluginBlocks";
import type { BlockNode } from "../../types";
import { GENERAL_TAB } from "../BlockSettings";
import {
	BlockAppConfigField,
	BlockCheckboxField,
	BlockIntegrationField,
	BlockJsTextField,
	BlockSelectField,
} from "../fields";
import { integrationParamPicker } from "../integrationField";
import {
	PluginArrayField,
	PluginFieldMapField,
	PluginHint,
	PluginJsField,
	PluginKeyValueField,
} from "./pluginEditorFields";
import {
	PluginConditionsField,
	PluginJsonField,
	PluginNumberField,
	PluginSchemaField,
} from "./pluginFields";

type ValueParam = Exclude<Param, HintParam>;

const MODE_LABELS: Record<string, string> = {
	sync: "Synchronous (Wait for output)",
	async: "Asynchronous (Fire & forget)",
	queued: "Queued (Durable background job)",
};

/** One param as its field; the value lands in the node's data under the param's name, as the runtime reads it. */
function ParamField({ block, name, param }: { block: BlockNode; name: string; param: ValueParam }) {
	const hint =
		[param.description, param.deprecated && `Deprecated: ${param.deprecated}`]
			.filter(Boolean)
			.join(" ") || undefined;
	const label = (param.label ?? name) + (param.required ? " *" : "");
	const shared = { blockId: block.id, data: block.data, name, label, hint };
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
					options={param.options.map((value) => ({ value, label: value }))}
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
					{...integrationParamPicker(param)}
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

/** a param's field, or a hint's callout */
export function Item({ block, name, param }: { block: BlockNode; name: string; param: Param }) {
	return param.type === "hint" ? (
		<PluginHint hint={param} />
	) : (
		<ParamField block={block} name={name} param={param} />
	);
}

/** What the block says about itself: the deprecation notice and how the call runs (only when more than one way is allowed). */
export function PluginBlockGeneral({ block }: { block: BlockNode }) {
	const def = usePluginBlocks().byType[block.type ?? ""];
	if (!def) return null;
	if (!def.deprecated && def.invoke.length < 2) return null;
	return (
		<div className="flex w-full flex-col gap-4">
			{def.deprecated && (
				<div
					role="status"
					className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning"
				>
					<TbAlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
					<span>Deprecated: {def.deprecated}</span>
				</div>
			)}
			{def.invoke.length > 1 && (
				<BlockSelectField
					blockId={block.id}
					data={block.data}
					name="invoke"
					label="Execution Mode"
					hint="Sync waits for the output. Async fires on this worker and is lost if it restarts. Queued is durable — another worker picks it up, and it may be retried."
					options={def.invoke.map((mode) => ({ value: mode, label: MODE_LABELS[mode] ?? mode }))}
				/>
			)}
		</div>
	);
}

/** the params (and hints) `visibleWhen` shows, by tab; a tab with no shown param is gone, whatever hints it has */
export function visibleTabs(
	params: Record<string, Param>,
	tabs: readonly string[] | undefined,
	data: BlockNode["data"],
) {
	// the runtime fills a default where the canvas left the param empty
	const values: Record<string, unknown> = {};
	for (const [name, p] of Object.entries(params)) if ("default" in p) values[name] = p.default;
	for (const [name, value] of Object.entries(data)) if (value != null) values[name] = value;
	const shown = (name: string) => {
		const when = params[name]?.visibleWhen;
		return !when || isVisible(when, values);
	};
	return paramTabs(params, tabs)
		.map((tab) => ({ name: tab.name, items: tab.params.filter(shown) }))
		.filter((tab) => tab.items.some((name) => params[name]?.type !== "hint"));
}

/**
 * A plugin block's params, drawn from its manifest entry: one tab per tab its
 * params use, in the manifest's order, minus the ones `visibleWhen` hides
 * (their values stay in the node). A single tab shows without a tab bar.
 */
export function PluginBlockSettings({ block }: { block: BlockNode }) {
	const { byType, isLoading } = usePluginBlocks();
	const [picked, setPicked] = useState<string>();
	const def = byType[block.type ?? ""];
	if (!def)
		return isLoading ? (
			<div className="flex items-center justify-center p-6 text-muted">
				<Spinner size="sm" />
			</div>
		) : (
			<p className="text-xs text-muted">
				This block's plugin is not installed in the project, so it has no settings.
			</p>
		);
	const params = def.entry.params as Record<string, Param>;
	const tabs = visibleTabs(params, def.entry.tabs, block.data);
	if (tabs.length === 0) return <p className="text-xs text-muted">This block has no parameters.</p>;
	// a picked tab that is hidden now moves the selection to the first one shown, for good
	const selected = tabs.find((t) => t.name === picked)?.name ?? tabs[0]?.name ?? "";
	if (picked !== undefined && picked !== selected) setPicked(undefined);

	const panel = (items: string[]) => (
		<div className="flex w-full flex-col gap-4">
			{items.map((name) => {
				const param = params[name];
				return param ? <Item key={name} block={block} name={name} param={param} /> : null;
			})}
		</div>
	);
	if (tabs.length === 1 && tabs[0]) return panel(tabs[0].items);
	return (
		<Tabs
			selectedKey={selected}
			onSelectionChange={(key) => setPicked(String(key))}
			variant="secondary"
		>
			<Tabs.ListContainer>
				<Tabs.List aria-label="Parameter tabs">
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
	);
}

export function usePluginBlockTabs(block: BlockNode) {
	const isPlugin = isPluginType(block.type);
	const { byType, isLoading } = usePluginBlocks();
	if (!isPlugin) return null;
	const def = block.type ? byType[block.type] : undefined;
	const params = (def?.entry?.params ?? {}) as Record<string, Param>;
	const tabs = def ? visibleTabs(params, def.entry.tabs, block.data) : [];
	const generalTab = tabs.find((t) => t.name === GENERAL_TAB);
	const otherTabs = tabs.filter((t) => t.name !== GENERAL_TAB);

	const generalContent = (
		<div key="plugin-general" className="flex w-full flex-col gap-4">
			<PluginBlockGeneral block={block} />
			{def ? (
				generalTab && generalTab.items.length > 0 ? (
					<div className="flex w-full flex-col gap-4">
						{generalTab.items.map((name) => {
							const param = params[name];
							return param ? <Item key={name} block={block} name={name} param={param} /> : null;
						})}
					</div>
				) : null
			) : isLoading ? (
				<div className="flex items-center justify-center p-6 text-muted">
					<Spinner size="sm" />
				</div>
			) : (
				<p className="text-xs text-muted">
					This block's plugin is not installed in the project, so it has no settings.
				</p>
			)}
		</div>
	);

	const authorTabs = otherTabs.map((tab) => ({
		name: tab.name,
		children: (
			<div className="flex w-full flex-col gap-4">
				{tab.items.map((name) => {
					const param = params[name];
					return param ? <Item key={name} block={block} name={name} param={param} /> : null;
				})}
			</div>
		),
	}));

	return {
		generalContent,
		authorTabs,
	};
}

export const pluginBlockSettings = (_block: BlockNode) => null;

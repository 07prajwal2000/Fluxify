import { Spinner } from "@fluxify/components";
import { isVisible } from "@fluxify/sdk";
import type { Param } from "@fluxify/sdk/blocks";
import { TbAlertTriangle } from "react-icons/tb";
import { usePluginBlocks } from "../../plugins/PluginBlocksContext";
import type { BlockNode } from "../../types";
import { BlockSettings, GENERAL_TAB } from "../BlockSettings";
import {
	BlockAppConfigField,
	BlockCheckboxField,
	BlockIntegrationField,
	BlockJsTextField,
	BlockSelectField,
	BlockTextField,
} from "../fields";
import {
	PluginConditionsField,
	PluginJsonField,
	PluginNumberField,
	PluginSchemaField,
} from "./pluginFields";

const MODE_LABELS: Record<string, string> = {
	sync: "Synchronous (Wait for output)",
	async: "Asynchronous (Fire & forget)",
	queued: "Queued (Durable background job)",
};

/** One param as its field; the value lands in the node's data under the param's name, as the runtime reads it. */
function ParamField({ block, name, param }: { block: BlockNode; name: string; param: Param }) {
	const hint =
		[param.description, param.deprecated && `Deprecated: ${param.deprecated}`]
			.filter(Boolean)
			.join(" ") || undefined;
	const label = (param.label ?? name) + (param.required ? " *" : "");
	const shared = { blockId: block.id, data: block.data, name, label, hint };
	switch (param.type) {
		case "string":
			return <BlockTextField {...shared} placeholder={param.default} />;
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
			return <BlockJsTextField {...shared} />;
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
	}
}

/** What the block says about itself: the deprecation notice and how the call runs (only when more than one way is allowed). */
export function PluginBlockGeneral({ block }: { block: BlockNode }) {
	const def = usePluginBlocks().byType[block.type ?? ""];
	if (!def) return null;
	if (!def.deprecated && def.invoke.length < 2)
		return <p className="text-xs text-muted">Nothing to set here; see Parameters.</p>;
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

/** A plugin block's params, drawn from its manifest entry minus the ones `visibleWhen` hides (their values stay in the node). */
export function PluginBlockSettings({ block }: { block: BlockNode }) {
	const { byType, isLoading } = usePluginBlocks();
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
	const params = Object.entries(def.entry.params as Record<string, Param>);
	// the runtime fills a default where the canvas left the param empty
	const values: Record<string, unknown> = {};
	for (const [name, p] of params) if ("default" in p) values[name] = p.default;
	for (const [name, value] of Object.entries(block.data)) if (value != null) values[name] = value;
	const shown = params.filter(([, p]) => !p.visibleWhen || isVisible(p.visibleWhen, values));
	if (shown.length === 0)
		return <p className="text-xs text-muted">This block has no parameters.</p>;

	return (
		<div className="flex w-full flex-col gap-4">
			{shown.map(([name, param]) => (
				<ParamField key={name} block={block} name={name} param={param} />
			))}
		</div>
	);
}

export const pluginBlockSettings = (block: BlockNode) => [
	<BlockSettings.TabHead key="general" name={GENERAL_TAB}>
		<PluginBlockGeneral block={block} />
	</BlockSettings.TabHead>,
	<BlockSettings.TabHead key="parameters" name="Parameters">
		<PluginBlockSettings block={block} />
	</BlockSettings.TabHead>,
];

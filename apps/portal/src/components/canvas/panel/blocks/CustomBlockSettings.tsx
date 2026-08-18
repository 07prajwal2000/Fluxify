import { useMemo } from "react";
import { Button, Spinner } from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { TbExternalLink } from "react-icons/tb";
import { withBasePath } from "@/constants/routes";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { BlockSettings, GENERAL_TAB } from "../BlockSettings";
import {
	BlockAppConfigField,
	BlockArrayEditorField,
	BlockCheckboxField,
	BlockIntegrationField,
	BlockJsTextField,
	BlockSelectField,
	type SelectOption,
} from "../fields";
import type { BlockNode } from "../../types";

export type CustomBlockInputParam = {
	name: string;
	label: string;
	type:
		| "text_input"
		| "checkbox"
		| "dropdown"
		| "array_editor"
		| "integration_selector"
		| "app_config_selector";
	options?: (string | { label: string; value: string })[];
	group?: string;
	tags?: string[];
	description?: string;
};

export function CustomBlockSettingsPanel({ block }: { block: BlockNode }) {
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params?.projectId ?? "";
	const { data: customBlocks, isLoading } = customBlocksQuery.getAll.useQuery(projectId);

	const customBlock = useMemo(() => {
		return customBlocks?.find((cb) => cb.name === block.type);
	}, [customBlocks, block.type]);

	const inputParams: CustomBlockInputParam[] = Array.isArray(customBlock?.inputParams)
		? (customBlock.inputParams as CustomBlockInputParam[])
		: [];

	if (isLoading) {
		return (
			<div className="flex items-center justify-center p-6 text-muted">
				<Spinner size="sm" />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 w-full">
			{inputParams.length > 0 ? (
				inputParams.map((param) => {
					switch (param.type) {
						case "text_input":
							return (
								<BlockJsTextField
									key={param.name}
									blockId={block.id}
									data={block.data}
									name={param.name}
									label={param.label}
									hint={param.description}
								/>
							);
						case "checkbox":
							return (
								<BlockCheckboxField
									key={param.name}
									blockId={block.id}
									data={block.data}
									name={param.name}
									label={param.label}
									hint={param.description}
								/>
							);
						case "dropdown": {
							const selectOptions: SelectOption[] = (param.options ?? []).map(
								(opt) =>
									typeof opt === "string"
										? { value: opt, label: opt }
										: { value: opt.value, label: opt.label },
							);
							return (
								<BlockSelectField
									key={param.name}
									blockId={block.id}
									data={block.data}
									name={param.name}
									label={param.label}
									hint={param.description}
									options={selectOptions}
								/>
							);
						}
						case "array_editor":
							return (
								<BlockArrayEditorField
									key={param.name}
									blockId={block.id}
									data={block.data}
									name={param.name}
									label={param.label}
									description={param.description}
								/>
							);
						case "integration_selector":
							return (
								<BlockIntegrationField
									key={param.name}
									blockId={block.id}
									data={block.data}
									name={param.name}
									label={param.label}
									description={param.description}
									group={param.group}
								/>
							);
						case "app_config_selector":
							return (
								<BlockAppConfigField
									key={param.name}
									blockId={block.id}
									data={block.data}
									name={param.name}
									label={param.label}
									description={param.description}
								/>
							);
						default:
							return null;
					}
				})
			) : (
				<div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted">
					This custom block has no configured input parameters.
				</div>
			)}
		</div>
	);
}

/** How the call runs — a property of the block, not one of its parameters. */
export function CustomBlockExecutionMode({ block }: { block: BlockNode }) {
	return (
		<BlockSelectField
			blockId={block.id}
			data={block.data}
			name="invoke"
			label="Execution Mode"
			hint="Sync waits for the output. Async fires on this worker and is lost if it restarts. Queued is durable — another worker picks it up, and it may be retried."
			placeholder="Select execution mode"
			options={[
				{ value: "sync", label: "Synchronous (Wait for output)" },
				{ value: "async", label: "Asynchronous (Fire & forget)" },
				{ value: "queued", label: "Queued (Durable background job)" },
			]}
		/>
	);
}

/**
 * Opening the block's own canvas is about the block, not about how this call
 * is configured, so it belongs with the name and description in General —
 * where anyone looking at the block first looks.
 */
export function CustomBlockSourceLink({ block }: { block: BlockNode }) {
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params?.projectId ?? "";
	const { data: customBlocks } = customBlocksQuery.getAll.useQuery(projectId);
	const customBlock = customBlocks?.find((cb) => cb.name === block.type);

	// Only a block defined in this project has a canvas the user can open.
	if (customBlock?.sourceType !== "user-defined" || !projectId) return null;

	return (
		<div className="flex items-center justify-between">
			<span className="text-xs text-muted">Custom Block Source</span>
			<Button
				variant="secondary"
				size="sm"
				className="h-7 text-xs gap-1.5"
				onPress={() =>
					window.open(
						withBasePath(`/${projectId}/custom-block-canvas/${customBlock.id}`),
						"_blank",
						"noopener,noreferrer",
					)
				}
			>
				<span>Edit Implementation</span>
				<TbExternalLink size={13} />
			</Button>
		</div>
	);
}

export function customBlockSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="source" name={GENERAL_TAB}>
			<CustomBlockSourceLink block={block} />
			<CustomBlockExecutionMode block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="parameters" name="Parameters">
			<CustomBlockSettingsPanel block={block} />
		</BlockSettings.TabHead>,
	];
}

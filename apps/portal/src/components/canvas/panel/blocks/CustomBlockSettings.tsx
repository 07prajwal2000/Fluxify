import { useMemo } from "react";
import { Button, Link, Spinner } from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { TbExternalLink } from "react-icons/tb";
import { withBasePath } from "@/constants/routes";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { BlockSettings } from "../BlockSettings";
import {
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
	type: "text_input" | "checkbox" | "dropdown" | "array_editor" | "integration_selector";
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
			{customBlock?.sourceType === "user-defined" && projectId && (
				<div className="flex items-center justify-between pb-2 border-b border-border">
					<span className="text-xs text-muted">Custom Block Source</span>
					<Button
						variant="secondary"
						size="sm"
						className="h-7 text-xs gap-1.5"
						onPress={() =>
							window.open(
								withBasePath(
									`/${projectId}/custom-blocks/${customBlock.id}`,
								),
								"_blank",
								"noopener,noreferrer",
							)
						}
					>
						<span>Edit Implementation</span>
						<TbExternalLink size={13} />
					</Button>
				</div>
			)}

			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="invoke"
				label="Execution Mode"
				hint="Sync waits for execution and passes output; Async fires in background."
				placeholder="Select execution mode"
				options={[
					{ value: "sync", label: "Synchronous (Wait for output)" },
					{ value: "async", label: "Asynchronous (Fire & forget)" },
				]}
			/>

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

export function customBlockSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="parameters" name="Parameters">
			<CustomBlockSettingsPanel block={block} />
		</BlockSettings.TabHead>,
	];
}

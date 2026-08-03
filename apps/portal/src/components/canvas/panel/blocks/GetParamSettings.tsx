import { BlockSettings } from "../BlockSettings";
import { BlockJsTextField, BlockSelectField } from "../fields";
import type { BlockNode } from "../../types";

const SOURCE_OPTIONS = [
	{ value: "path", label: "Path Param" },
	{ value: "query", label: "Query Param" },
];

/** Get Param block settings. Configures parameter source and name from request. */
export function GetParamSettings({ block }: { block: BlockNode }) {
	const source = (block.data.source as string) || "query";

	return (
		<div className="flex flex-col gap-4">
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="source"
				label="Parameter Source"
				placeholder="Select parameter source"
				options={SOURCE_OPTIONS}
				hint="The source of the parameter (path or query)."
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="name"
				label="Parameter Name"
				placeholder={source === "path" ? "userId" : "id"}
				hint={
					source === "path"
						? "Enter parameter name defined in the route pattern."
						: "Enter parameter name passed in the query string."
				}
			/>
			<div className="flex flex-col gap-1.5 mt-1">
				<span className="text-xs text-muted">Example URL reference:</span>
				<pre className="px-3 py-2 rounded-md bg-[var(--surface-secondary,#18181b)] border border-[var(--border,#27272a)] font-mono text-xs text-[var(--foreground,#fafafa)] whitespace-pre-wrap break-all select-all">
					{source === "path"
						? "/:userId (e.g. enter 'userId')"
						: "?id=123 (e.g. enter 'id')"}
				</pre>
			</div>
		</div>
	);
}

export function getParamSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<GetParamSettings block={block} />
		</BlockSettings.TabHead>
	);
}

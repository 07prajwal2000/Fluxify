import { useState } from "react";
import type { ToolPart } from "../agentMessages";
import { Notice } from "./Notice";
import { RawView } from "./RawView";
import { previewOf } from "./ToolPreview";

const TABS = [
	["preview", "Preview"],
	["raw", "Raw"],
] as const;

/**
 * What a tool row shows when open: Preview (default) and Raw (today's JSON) tabs.
 * A tool without a preview shows Raw alone. An error is on top of the preview, never hidden by it.
 */
export function ToolBody({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	const [tab, setTab] = useState<(typeof TABS)[number][0]>("preview");
	const preview = previewOf(tool, asking);
	if (preview === null) return <RawView tool={tool} />;
	return (
		<div className="flex flex-col gap-2">
			<div role="tablist" aria-label="View" className="flex gap-1">
				{TABS.map(([id, label]) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={tab === id}
						onClick={() => setTab(id)}
						className={`cursor-pointer rounded-md px-2 py-0.5 text-xs ${
							tab === id
								? "bg-surface-secondary font-medium text-foreground"
								: "text-muted hover:text-foreground"
						}`}
					>
						{label}
					</button>
				))}
			</div>
			{tab === "raw" ? (
				<RawView tool={tool} />
			) : (
				<>
					{tool.error !== undefined && <Notice tone="danger">{tool.error}</Notice>}
					{preview}
				</>
			)}
		</div>
	);
}

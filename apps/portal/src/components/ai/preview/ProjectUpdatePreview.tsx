import { TbSettings } from "react-icons/tb";
import type { ToolPart } from "../agentMessages";
import { rec, str } from "./data";
import { Notice } from "./Notice";

/** Previews update_project tool. */
export function ProjectUpdatePreview({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const name = str(out.name) || str(input.name);
	const desc = str(out.description) || str(input.description);

	return (
		<div className="flex flex-col gap-2 text-xs">
			<header className="flex items-center gap-2 text-sm">
				<TbSettings size={16} className="shrink-0 text-muted" />
				<span className="font-medium text-foreground">Update project</span>
				{name && <span className="font-medium text-muted">({name})</span>}
			</header>
			{asking && <Notice tone="warning">This action will update project settings.</Notice>}
			<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				{name && (
					<>
						<dt className="text-muted">Name</dt>
						<dd className="font-medium text-foreground">{name}</dd>
					</>
				)}
				{desc && (
					<>
						<dt className="text-muted">Description</dt>
						<dd className="text-foreground">{desc}</dd>
					</>
				)}
			</dl>
		</div>
	);
}

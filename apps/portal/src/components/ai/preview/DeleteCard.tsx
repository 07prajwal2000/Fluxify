import { TbTrash } from "react-icons/tb";
import type { ToolPart } from "../agentMessages";
import { rec, str } from "./data";
import { KeyFields } from "./KeyFields";
import { META, nameOf, resourceOf, routeLine } from "./resourceMeta";
import { useCurrent } from "./useCurrent";

/** A delete_* call: what goes, marked as danger. */
export function DeleteCard({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	const res = resourceOf(tool.name);
	const input = rec(tool.input);
	const type = res?.type ?? "route";
	const id = str(input[META[type].idKey]);
	const { current, loading } = useCurrent(tool.name, input, asking);
	if (!res) return null;
	const data = current ?? {};
	const label = type.replace("_", " ");
	const name = nameOf(type, data) || `${label} ${id.slice(0, 8)}`;
	const done = !asking && tool.output !== undefined;
	return (
		<section
			aria-label={`Delete ${label}`}
			className="flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3"
		>
			<header className="flex flex-wrap items-center gap-2 text-sm">
				<TbTrash size={16} className="shrink-0 text-danger" />
				<span className="font-medium text-danger">
					{done ? "Deleted" : "Deletes"} {label}
				</span>
				<span className="font-medium text-foreground">{name}</span>
				{type === "route" && routeLine(data) && (
					<code className="rounded bg-surface-secondary px-1.5 text-xs">{routeLine(data)}</code>
				)}
			</header>
			{loading && <div className="h-8 animate-pulse rounded bg-surface-secondary" aria-busy />}
			<KeyFields type={type} data={data} />
			{!done && <p className="text-xs text-danger">This cannot be undone.</p>}
		</section>
	);
}

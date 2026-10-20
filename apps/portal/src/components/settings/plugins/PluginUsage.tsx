import { Spinner } from "@fluxify/components";
import { pluginsQuery } from "@/query/pluginsQuery";
import { Badge } from "./PluginBadges";
import { PluginUserLink } from "./PluginUserLink";

/** Every route, workflow and custom block that uses a block of this plugin, each linked to its canvas. */
export function PluginUsage({ projectId, name }: { projectId: string; name: string }) {
	const { data } = pluginsQuery.usage.useQuery(projectId, name);
	if (!data) return <Spinner size="sm" />;
	if (!data.length) return <p className="text-sm text-muted">Not used anywhere yet.</p>;
	return (
		<ul aria-label="Used by" className="flex flex-col gap-2">
			{data.map((u) => (
				<li key={`${u.kind}-${u.id}`} className="flex flex-wrap items-center gap-2 text-xs">
					<PluginUserLink user={u} projectId={projectId} />
					{u.inProduction && <Badge tone="success">In production</Badge>}
					{u.inWorkingCopy && <Badge tone="muted">Working copy</Badge>}
					<span className="text-muted">
						{u.nodes.length} {u.nodes.length === 1 ? "block" : "blocks"}
					</span>
				</li>
			))}
		</ul>
	);
}

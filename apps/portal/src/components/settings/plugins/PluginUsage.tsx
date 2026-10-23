import { Spinner } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { TbBolt, TbCloudCog } from "react-icons/tb";
import { pluginsQuery } from "@/query/pluginsQuery";
import { Badge } from "./PluginBadges";
import { PluginUserLink } from "./PluginUserLink";

/**
 * Everything using a plugin: its blocks on canvases, the project's trigger rows
 * of its kinds, and the integrations of its kinds. Every entry links to where
 * it can be changed.
 */
export function PluginUsage({ projectId, name }: { projectId: string; name: string }) {
	const { data } = pluginsQuery.usage.useQuery(projectId, name);
	if (!data) return <Spinner size="sm" />;
	if (!data.blocks.length && !data.triggers.length && !data.integrations.length)
		return <p className="text-sm text-muted">Not used anywhere yet.</p>;
	return (
		<div className="flex flex-col gap-4">
			{data.blocks.length > 0 && (
				<ul aria-label="Blocks using the plugin" className="flex flex-col gap-2">
					{data.blocks.map((u) => (
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
			)}

			{data.triggers.length > 0 && (
				<section className="flex flex-col gap-1.5">
					<h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Triggers</h3>
					<ul aria-label="Triggers using the plugin" className="flex flex-col gap-1.5">
						{data.triggers.map((trigger) => (
							<li key={trigger.id} className="flex flex-wrap items-center gap-2 text-xs">
								<span className="text-muted">
									<TbBolt size={15} />
								</span>
								<Link
									to="/$projectId/triggers/$triggerId"
									params={{ projectId, triggerId: trigger.id }}
									className="font-medium text-accent hover:underline"
								>
									{trigger.name}
								</Link>
								<code className="font-mono text-xs text-muted">{trigger.kind}</code>
							</li>
						))}
					</ul>
				</section>
			)}

			{data.integrations.length > 0 && (
				<section className="flex flex-col gap-1.5">
					<h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
						Integrations
					</h3>
					<ul aria-label="Integrations of the plugin" className="flex flex-col gap-1.5">
						{data.integrations.map((integration) => (
							<li key={integration.id} className="flex flex-wrap items-center gap-2 text-xs">
								<span className="text-muted">
									<TbCloudCog size={15} />
								</span>
								<Link
									to="/$projectId/integrations/$integrationId"
									params={{ projectId, integrationId: integration.id }}
									className="font-medium text-accent hover:underline"
								>
									{integration.name}
								</Link>
								<code className="font-mono text-xs text-muted">
									{integration.group}/{integration.variant}
								</code>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

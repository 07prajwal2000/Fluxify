import { Spinner } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { TbBox } from "react-icons/tb";
import { ApprovalBadge, Badge, StatusBadge } from "@/components/settings/plugins/PluginBadges";
import { pluginsQuery } from "@/query/pluginsQuery";
import { pluginBlockGroups } from "./pluginBlocks";

/**
 * The blocks plugins ship, under the Custom Blocks list (#862). They have no
 * custom-block rows, so they cannot be opened, versioned or deleted here: each
 * group links to its plugin's page, where they are managed.
 */
export function PluginBlocksSection({
	projectId,
	search,
	hidden,
}: {
	projectId: string;
	search: string;
	/** a usage filter is on: plugin blocks have no usage, so none match */
	hidden: boolean;
}) {
	const { data, isLoading } = pluginsQuery.list.useQuery(projectId);
	if (hidden) return null;
	if (isLoading) return <Spinner size="sm" />;
	const groups = pluginBlockGroups(data ?? [], search);

	return (
		<section aria-label="Plugin blocks" className="flex flex-col gap-4">
			<h2 className="text-sm font-semibold text-foreground">Plugin blocks</h2>
			{!groups.length && (
				<p className="text-sm text-muted">No plugin block is loaded in this project.</p>
			)}
			{groups.map(({ key, plugin, blocks }) => (
				<div key={key} className="flex flex-col gap-2">
					<div className="flex flex-wrap items-center gap-2">
						<code className="font-mono text-xs text-muted">{key}</code>
						<ApprovalBadge plugin={plugin} />
						<StatusBadge plugin={plugin} />
						<Link
							to="/$projectId/settings"
							params={{ projectId }}
							search={{ tab: "plugins", plugin: plugin.name }}
							className="text-xs font-medium text-accent hover:underline"
						>
							Open plugin
						</Link>
					</div>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
						{blocks.map((b) => (
							<div
								key={b.name}
								className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3"
							>
								<TbBox size={20} className="mt-0.5 shrink-0 text-muted" />
								<div className="flex min-w-0 flex-col gap-0.5">
									<div className="flex items-center gap-2">
										<span className="truncate text-sm font-medium text-foreground">{b.label}</span>
										{b.deprecated && <Badge tone="warning">Deprecated</Badge>}
									</div>
									<p className="truncate font-mono text-xs text-muted">{b.name}</p>
									<p className="text-xs text-muted">{b.shape} shape</p>
								</div>
							</div>
						))}
					</div>
				</div>
			))}
		</section>
	);
}

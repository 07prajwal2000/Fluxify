import { Chip } from "@fluxify/components";
import type { NodeView } from "@/services/orchestration";
import { REASON_LABEL, STATE_LABEL, TYPE_LABEL, ago, providerWords } from "./copy";

/**
 * One node per row, used by both surfaces.
 *
 * Two facts are deliberately shown side by side: the state, which comes from
 * what the orchestrator observed, and the heartbeat, which comes from the
 * worker itself. A node whose container is up and whose worker has gone quiet
 * is the condition worth seeing, and only having both makes it visible.
 */
export function NodeList({
	nodes,
	provider,
	showProject = false,
	empty = "No nodes yet.",
}: {
	nodes: NodeView[];
	provider: string | null;
	showProject?: boolean;
	empty?: string;
}) {
	const words = providerWords(provider);

	if (nodes.length === 0) {
		return <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>;
	}

	return (
		<div className="flex flex-col divide-y divide-border">
			{nodes.map((node) => {
				const state = STATE_LABEL[node.state] ?? { label: node.state, color: "default" as const };
				return (
					<div key={node.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<span className="truncate font-mono text-xs text-foreground">{node.id}</span>
								<Chip size="sm" color={state.color}>
									{state.label}
								</Chip>
							</div>
							<p className="mt-1 text-xs text-muted">
								{TYPE_LABEL[node.type] ?? node.type}
								{showProject && ` · ${node.projectId ?? "every project"}`}
								{node.groupIds.length > 0 && ` · ${node.groupIds.length} group(s)`}
								{node.projectId === null && node.groupIds.length === 0 && " · every unclaimed group"}
							</p>
							{node.reason && (
								<p className="mt-1 text-xs text-warning">{REASON_LABEL[node.reason] ?? node.reason}</p>
							)}
						</div>

						<div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted">
							<span>
								{node.live ? `Heartbeat ${ago(node.lastHeartbeatAt)}` : "No heartbeat"}
							</span>
							{node.containerId && (
								<span className="font-mono" title={`${words.handle}: ${node.containerId}`}>
									{words.node} {node.containerId.slice(0, 12)}
								</span>
							)}
							{node.image && <span className="font-mono opacity-70">{node.image}</span>}
						</div>
					</div>
				);
			})}
		</div>
	);
}

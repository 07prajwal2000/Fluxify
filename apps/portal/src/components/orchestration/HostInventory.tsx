import { Chip } from "@fluxify/components";
import type { OrchestrationStatus } from "@/services/orchestration";
import { ago, providerWords } from "./copy";

/**
 * What is actually on the host, as the orchestrator last saw it.
 *
 * Every other panel renders *intent* — claims, and the nodes those claims ask
 * for. This one renders the platform's own answer, which is the only place two
 * cases show up: a container no claim wants (an orphan the next pass removes),
 * and a container that is up but crash-looping. Without it the honest way to
 * check either was the Docker CLI.
 */
export function HostInventory({ status }: { status: OrchestrationStatus }) {
	const words = providerWords(status.orchestrator.provider);
	const { at, nodes } = status.host;
	const unclaimed = nodes.filter((node) => !node.claimed).length;

	return (
		<section className="overflow-hidden rounded-xl border border-border bg-background">
			<header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
				<div>
					<h3 className="text-sm font-bold text-foreground">
						On this host ({nodes.length})
					</h3>
					<p className="mt-0.5 text-xs text-muted">
						Every {words.node} tagged as this instance's, as the orchestrator last saw it.
					</p>
				</div>
				<span className="shrink-0 text-xs text-muted">
					{at ? `Looked ${ago(at)}` : "Nothing reporting"}
				</span>
			</header>

			{!at ? (
				<p className="px-4 py-6 text-center text-xs text-muted">
					No orchestrator is reporting, so this list is unknown rather than empty. Whatever is
					running keeps running — nothing is being reconciled.
				</p>
			) : nodes.length === 0 ? (
				<p className="px-4 py-6 text-center text-xs text-muted">
					No {words.node}s are tagged as this instance's.
				</p>
			) : (
				<div className="flex flex-col divide-y divide-border">
					{nodes.map((node) => (
						<div key={node.containerId} className="flex flex-wrap items-center gap-3 px-4 py-3">
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center gap-2">
									<span className="truncate font-mono text-xs text-foreground">
										{node.nodeId}
									</span>
									<Chip size="sm" color={node.running ? "success" : "danger"}>
										{node.platformState}
									</Chip>
									{!node.claimed && (
										<Chip size="sm" color="warning">
											No claim
										</Chip>
									)}
								</div>
								<p className="mt-1 font-mono text-xs text-muted">
									{node.projectId ?? "every project"} · {node.image}
								</p>
							</div>
							<span
								className="shrink-0 font-mono text-xs text-muted"
								title={`${words.handle}: ${node.containerId}`}
							>
								{node.containerId.slice(0, 12)}
							</span>
						</div>
					))}
				</div>
			)}

			{unclaimed > 0 && (
				<p className="border-t border-border px-4 py-3 text-xs text-warning">
					{unclaimed} {words.node}(s) here belong to no claim. The next reconcile pass drains and
					removes them.
				</p>
			)}
		</section>
	);
}

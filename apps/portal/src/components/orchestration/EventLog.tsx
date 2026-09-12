import { Chip, Spinner } from "@fluxify/components";
import type { OrchestrationEvent } from "@/services/orchestration";
import { ACTION_LABEL, REASON_LABEL, ago } from "./copy";

/**
 * What the orchestrator has actually done, newest first.
 *
 * The reason this is on the page rather than only in logs: a node that was
 * created and removed leaves no row behind, so without the history a scale-down
 * or a failed image pull is invisible — the page would simply show one fewer
 * node and no explanation.
 */
export function EventLog({
	events,
	isLoading,
	showProject = false,
}: {
	events: OrchestrationEvent[] | undefined;
	isLoading?: boolean;
	showProject?: boolean;
}) {
	if (isLoading) {
		return (
			<div className="flex justify-center py-8">
				<Spinner />
			</div>
		);
	}
	if (!events?.length) {
		return <p className="px-4 py-6 text-center text-sm text-muted">Nothing has happened yet.</p>;
	}

	return (
		<ol className="flex flex-col divide-y divide-border">
			{events.map((event) => {
				const failed = event.action.endsWith("_failed");
				return (
					<li key={event.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-sm text-foreground">
									{ACTION_LABEL[event.action] ?? event.action}
								</span>
								{failed && (
									<Chip size="sm" color="danger">
										Failed
									</Chip>
								)}
								{showProject && (
									<span className="text-xs text-muted">
										{event.projectId ?? "every project"}
									</span>
								)}
							</div>
							{event.nodeId && (
								<p className="mt-0.5 font-mono text-xs text-muted">{event.nodeId}</p>
							)}
							{event.reason && (
								<p className="mt-0.5 text-xs text-warning">
									{REASON_LABEL[event.reason] ?? event.reason}
								</p>
							)}
							<EventDetail detail={event.detail} />
						</div>
						<span className="shrink-0 text-xs text-muted">{ago(event.createdAt)}</span>
					</li>
				);
			})}
		</ol>
	);
}

/**
 * The parts of an event's detail worth a sentence. Everything else stays out —
 * a raw JSON dump in a status page is noise, and the interesting cases are few:
 * what a change actually did, and what went wrong.
 */
function EventDetail({ detail }: { detail: Record<string, unknown> | null }) {
	if (!detail) return null;
	const lines: string[] = [];

	if (typeof detail.scaledBy === "number" && detail.scaledBy !== 0)
		lines.push(
			detail.scaledBy > 0
				? `${detail.scaledBy} more node(s) asked for`
				: `${Math.abs(detail.scaledBy)} node(s) drained`,
		);
	if (detail.appliedLive === true) lines.push("Applied to the running nodes, no restart");
	if (typeof detail.why === "string") lines.push(`Replaced because the ${detail.why} changed`);
	if (typeof detail.error === "string") lines.push(detail.error);

	if (lines.length === 0) return null;
	return <p className="mt-0.5 text-xs text-muted">{lines.join(" · ")}</p>;
}

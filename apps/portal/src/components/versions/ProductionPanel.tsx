import { cn } from "@fluxify/components";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatDateTime, getTimeAgo } from "@/lib/datetime";
import { deploymentsQuery } from "@/query/deploymentsQuery";
import type { Deployment } from "@/services/deployments";
import type { Version, VersionKind } from "@/services/versions";
import { GateList } from "./DeploymentGates";

const STATUS_TONE: Record<Deployment["status"], string> = {
	pending: "bg-warning/10 text-warning",
	live: "bg-success/10 text-success",
	failed: "bg-danger/10 text-danger",
};

const ACTION_LABEL: Record<Deployment["action"], string> = {
	promote: "Promote",
	rollback: "Rollback",
};

/**
 * Only the deployment serving production now says "Live"; an earlier one that
 * succeeded says what it did. A row stuck on Pending while the gates ran reads
 * as such until the log catches up (#739).
 */
function statusLabel(deployment: Deployment, liveId: string | undefined) {
	if (deployment.status === "pending") return "Pending";
	if (deployment.status === "failed") return "Failed";
	if (deployment.id === liveId) return "Live";
	return deployment.action === "rollback" ? "Rolled back" : "Promoted";
}

const authorOf = (deployment: Deployment) =>
	deployment.author ?? deployment.authorEmail ?? "Unknown author";

function DeploymentRow({
	kind,
	id,
	projectId,
	deployment,
	liveId,
}: {
	kind: VersionKind;
	id: string;
	projectId: string;
	deployment: Deployment;
	liveId: string | undefined;
}) {
	const [open, setOpen] = useState(false);
	const failed = deployment.gates.some((gate) => gate.status === "failed");
	return (
		<li className="flex flex-col gap-1 border-t border-border px-4 py-2">
			<div className="flex items-center gap-2 text-xs">
				<span className="font-mono font-semibold">v{deployment.versionNumber}</span>
				{deployment.status !== "live" && (
					<span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
						{ACTION_LABEL[deployment.action]}
					</span>
				)}
				<span
					className={cn(
						"rounded-md px-1.5 py-0.5 text-[11px] font-medium",
						STATUS_TONE[deployment.status],
					)}
				>
					{statusLabel(deployment, liveId)}
				</span>
				<time
					className="ml-auto text-muted"
					dateTime={deployment.createdAt}
					title={formatDateTime(deployment.createdAt)}
				>
					{getTimeAgo(deployment.createdAt)}
				</time>
			</div>
			<p className="text-xs text-muted">{deployment.description}</p>
			<div className="flex items-center gap-2 text-[11px] text-muted">
				<span>{authorOf(deployment)}</span>
				{failed && (
					<button
						type="button"
						className="text-danger hover:underline"
						onClick={() => setOpen((current) => !current)}
					>
						{open ? "Hide failed checks" : "Show failed checks"}
					</button>
				)}
			</div>
			{open && <GateList kind={kind} id={id} projectId={projectId} deployment={deployment} />}
		</li>
	);
}

/**
 * Production's state and log (#739): the version that is live, then every
 * promote and rollback newest first, with the reasons a failed one gives. Shown
 * in the history's Production tab, so it no longer crowds the version list.
 */
export function ProductionPanel({
	kind,
	id,
	projectId,
	versions,
}: {
	kind: VersionKind;
	id: string;
	projectId: string;
	versions: Version[];
}) {
	const { data } = deploymentsQuery.list.useQuery(kind, id);
	const deployments = data?.deployments ?? [];
	const live = versions.find((version) => version.isProd) ?? null;
	// newest-first, so the first live one is the deployment serving production now
	const liveDeployment = deployments.find((deployment) => deployment.status === "live");
	const liveId = liveDeployment?.id;

	// A promote/rollback that settles while this panel is open (or one closed in
	// the dialog) still has to refresh the isProd badges on the version list.
	const queryClient = useQueryClient();
	const group = kind === "route" ? "routes" : "workflows";
	const liveVersionId = liveDeployment?.versionId;
	const prodVersionId = live?.id;
	useEffect(() => {
		if (!liveVersionId || prodVersionId === liveVersionId) return;
		void queryClient.invalidateQueries({ queryKey: [group, id, "versions"] });
		void queryClient.invalidateQueries({ queryKey: [group, id, "by-id"] });
	}, [liveVersionId, prodVersionId, group, id, queryClient]);

	return (
		<div className="pb-1">
			<p className="px-4 py-2 text-xs">
				{live ? (
					<>
						In production:{" "}
						<span className="font-mono font-semibold text-accent">v{live.versionNumber}</span> ·{" "}
						{live.title}
					</>
				) : (
					<span className="text-muted">Not in production yet</span>
				)}
			</p>
			{deployments.length > 0 ? (
				<ul aria-label="Production history" className="flex flex-col">
					{deployments.map((deployment) => (
						<DeploymentRow
							key={deployment.id}
							kind={kind}
							id={id}
							projectId={projectId}
							deployment={deployment}
							liveId={liveId}
						/>
					))}
				</ul>
			) : (
				<p className="px-4 pb-2 text-xs text-muted">No promotes or rollbacks yet.</p>
			)}
		</div>
	);
}

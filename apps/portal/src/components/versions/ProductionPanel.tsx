import { cn } from "@fluxify/components";
import { useState } from "react";
import { TbChevronDown, TbChevronRight } from "react-icons/tb";
import { getTimeAgo } from "@/lib/datetime";
import { deploymentsQuery } from "@/query/deploymentsQuery";
import type { Deployment } from "@/services/deployments";
import type { Version, VersionKind } from "@/services/versions";
import { GateList } from "./DeploymentGates";

const STATUS_TONE: Record<Deployment["status"], string> = {
	pending: "bg-warning/10 text-warning",
	live: "bg-success/10 text-success",
	failed: "bg-danger/10 text-danger",
};

const STATUS_LABEL: Record<Deployment["status"], string> = {
	pending: "Pending",
	live: "Live",
	failed: "Failed",
};

const ACTION_LABEL: Record<Deployment["action"], string> = {
	promote: "Promote",
	rollback: "Rollback",
};

const authorOf = (deployment: Deployment) =>
	deployment.author ?? deployment.authorEmail ?? "Unknown author";

function DeploymentRow({ kind, deployment }: { kind: VersionKind; deployment: Deployment }) {
	const [open, setOpen] = useState(false);
	const failed = deployment.gates.some((gate) => gate.status === "failed");
	return (
		<li className="flex flex-col gap-1 border-t border-border px-4 py-2">
			<div className="flex items-center gap-2 text-xs">
				<span className="font-mono font-semibold">v{deployment.versionNumber}</span>
				<span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
					{ACTION_LABEL[deployment.action]}
				</span>
				<span
					className={cn(
						"rounded-md px-1.5 py-0.5 text-[11px] font-medium",
						STATUS_TONE[deployment.status],
					)}
				>
					{STATUS_LABEL[deployment.status]}
				</span>
				<span className="ml-auto text-muted">{getTimeAgo(deployment.createdAt)}</span>
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
			{open && <GateList kind={kind} deployment={deployment} />}
		</li>
	);
}

/**
 * Production's state and log (#739), at the top of the version list: the version
 * that is live, then every promote and rollback newest first, with the reasons a
 * failed one gives. Collapsible, so it stays out of the way once read.
 */
export function ProductionPanel({
	kind,
	id,
	versions,
}: {
	kind: VersionKind;
	id: string;
	versions: Version[];
}) {
	const [open, setOpen] = useState(true);
	const { data } = deploymentsQuery.list.useQuery(kind, id);
	const live = versions.find((version) => version.isProd) ?? null;
	const deployments = data?.deployments ?? [];

	return (
		<section aria-label="Production" className="border-b border-border">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-xs font-semibold text-foreground hover:bg-surface-secondary"
			>
				{open ? <TbChevronDown size={14} /> : <TbChevronRight size={14} />}
				Production
			</button>
			{open && (
				<div className="pb-1">
					<p className="px-4 pb-2 text-xs">
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
					{deployments.length > 0 && (
						<ul aria-label="Production history" className="flex flex-col">
							{deployments.map((deployment) => (
								<DeploymentRow key={deployment.id} kind={kind} deployment={deployment} />
							))}
						</ul>
					)}
				</div>
			)}
		</section>
	);
}

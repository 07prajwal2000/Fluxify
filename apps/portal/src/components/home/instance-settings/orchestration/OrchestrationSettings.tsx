import { useState } from "react";
import { Button, Spinner, cn, toast } from "@fluxify/components";
import { TbHistory, TbTopologyStar3 } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ClaimCard } from "@/components/orchestration/ClaimCard";
import { ClaimDialog } from "@/components/orchestration/ClaimDialog";
import { CONSEQUENCE } from "@/components/orchestration/copy";
import { GroupAlarms } from "@/components/orchestration/GroupAlarms";
import { HostInventory } from "@/components/orchestration/HostInventory";
import { InfraPanel } from "@/components/orchestration/InfraPanel";
import { NodeHistoryView } from "@/components/orchestration/NodeHistoryView";
import { showErrorNotification } from "@/lib/errorNotifier";
import { orchestrationQuery } from "@/query/orchestrationQuery";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";
import type { ClaimView } from "@/services/orchestration";
import { PoolForm } from "./PoolForm";

/**
 * The operator's surface (§14.5): every node on the instance, which project
 * each serves, and the pool they all come out of.
 *
 * Separate from the project surface on purpose. A project owner asks for
 * capacity; the operator decides how much capacity exists. One page would mean
 * either an operator sizing pools per project, or a project owner looking at
 * everyone else's workloads.
 */
export function OrchestrationSettings() {
	const { data: publicSettings } = publicSettingsQuery.get.useQuery();
	const available = publicSettings?.orchestration?.enabled !== false;

	const { data: status, isLoading } = orchestrationQuery.instance.useQuery(available);
	const { data: events, isLoading: eventsLoading } =
		orchestrationQuery.instanceEvents.useQuery(available);
	const update = orchestrationQuery.updateInstanceClaim.useMutation();
	const release = orchestrationQuery.releaseInstanceClaim.useMutation();

	const [editing, setEditing] = useState<ClaimView | null>(null);
	const [releasing, setReleasing] = useState<ClaimView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"workloads" | "history">("workloads");

	if (!available) {
		return (
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
				<h2 className="text-xl font-bold tracking-tight">Orchestration</h2>
				<p className="text-sm text-muted-foreground">
					This build runs admin, a worker and everything else in one process tree, with no
					orchestrator. There is one node by construction, so there is nothing to place or size.
					Orchestration appears on a production deployment.
				</p>
			</div>
		);
	}
	if (isLoading || !status) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
			<div>
				<h2 className="text-xl font-bold tracking-tight">Orchestration</h2>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Every worker node on this instance, and how much of this host they are allowed to use.
				</p>
			</div>

			<div className="flex items-center gap-6 border-b border-border">
				<button
					type="button"
					onClick={() => setActiveTab("workloads")}
					className={cn(
						"-mb-px flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors",
						activeTab === "workloads"
							? "border-accent text-foreground"
							: "border-transparent text-muted hover:border-border hover:text-foreground",
					)}
				>
					<TbTopologyStar3
						size={16}
						className={activeTab === "workloads" ? "text-accent" : "text-muted"}
					/>
					Workloads & Pool
				</button>

				<button
					type="button"
					onClick={() => setActiveTab("history")}
					className={cn(
						"-mb-px flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors",
						activeTab === "history"
							? "border-accent text-foreground"
							: "border-transparent text-muted hover:border-border hover:text-foreground",
					)}
				>
					<TbHistory
						size={16}
						className={activeTab === "history" ? "text-accent" : "text-muted"}
					/>
					History
					{events && events.length > 0 && (
						<span
							className={cn(
								"rounded-full px-2 py-0.5 text-xs font-semibold transition-colors",
								activeTab === "history"
									? "bg-accent/10 text-accent"
									: "bg-surface-secondary text-muted",
							)}
						>
							{events.length}
						</span>
					)}
				</button>
			</div>

			{activeTab === "workloads" ? (
				<div className="flex flex-col gap-6">
					<GroupAlarms alarms={status.alarms} />
					<InfraPanel status={status} />
					<PoolForm pool={status.pool} />

					<div className="flex flex-col gap-3">
						<h3 className="text-sm font-bold text-foreground">
							Claims ({status.claims.length})
						</h3>
						{status.claims.length === 0 ? (
							<p className="rounded-xl border border-border bg-background p-6 text-center text-xs text-muted">
								Nothing is claimed, so no workers are running and no API answers. A fresh instance is
								normally seeded with one catch-all claim.
							</p>
						) : (
							status.claims.map((claim) => (
								<ClaimCard
									key={claim.id}
									claim={claim}
									provider={status.orchestrator.provider}
									showProject
									onChange={() => {
										setError(null);
										setEditing(claim);
									}}
									onRelease={() => setReleasing(claim)}
								/>
							))
						)}
					</div>

					<HostInventory status={status} />

					{events && events.length > 0 && (
						<div className="flex items-center justify-between rounded-xl border border-border bg-background p-4">
							<div className="flex items-center gap-3">
								<div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted">
									<TbHistory size={18} />
								</div>
								<div>
									<h4 className="text-sm font-semibold text-foreground">Instance Activity & History</h4>
									<p className="text-xs text-muted">
										{events.length} lifecycle event{events.length === 1 ? "" : "s"} recorded across this instance.
									</p>
								</div>
							</div>
							<Button size="sm" variant="secondary" onPress={() => setActiveTab("history")}>
								View history
							</Button>
						</div>
					)}
				</div>
			) : (
				<NodeHistoryView events={events} isLoading={eventsLoading} showProject />
			)}

			{editing && (
				<ClaimDialog
					isOpen
					status={status}
					// Group names are a project's vocabulary, and this page spans every
					// project — so ids are shown as they are rather than guessed at.
					groups={editing.groupIds.map((id) => ({ id, name: id }))}
					claim={editing}
					isPending={update.isPending}
					error={error}
					onClose={() => {
						setEditing(null);
						setError(null);
					}}
					onSubmit={(body) =>
						update.mutate(
							{ claimId: editing.id, body: body },
							{
								onSuccess: (result) => {
									toast.success(result.message);
									setEditing(null);
								},
								onError: (err) => {
									setError(messageOf(err));
									showErrorNotification(err as Error);
								},
							},
						)
					}
				/>
			)}

			<ConfirmDialog
				open={releasing !== null}
				onOpenChange={(open) => !open && setReleasing(null)}
				title="Release this claim?"
				confirmText="Release"
				danger
				pending={release.isPending}
				onConfirm={() => {
					if (!releasing) return;
					release.mutate(releasing.id, {
						onSuccess: (result) => {
							toast.success(result.message);
							setReleasing(null);
						},
						onError: (err) => showErrorNotification(err as Error),
					});
				}}
			>
				{CONSEQUENCE.release}
			</ConfirmDialog>
		</div>
	);
}

function messageOf(error: unknown): string {
	const response = (error as { response?: { data?: { message?: string; error?: string } } })
		?.response?.data;
	return response?.message ?? response?.error ?? "That was refused.";
}

import { useState } from "react";
import { Spinner, toast } from "@fluxify/components";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ClaimCard } from "@/components/orchestration/ClaimCard";
import { ClaimDialog } from "@/components/orchestration/ClaimDialog";
import { CONSEQUENCE } from "@/components/orchestration/copy";
import { EventLog } from "@/components/orchestration/EventLog";
import { GroupAlarms } from "@/components/orchestration/GroupAlarms";
import { HostInventory } from "@/components/orchestration/HostInventory";
import { InfraPanel } from "@/components/orchestration/InfraPanel";
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
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
			<div>
				<h2 className="text-xl font-bold tracking-tight">Orchestration</h2>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Every worker node on this instance, and how much of this host they are allowed to use.
				</p>
			</div>

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

			<section className="overflow-hidden rounded-xl border border-border bg-background">
				<header className="border-b border-border p-4">
					<h3 className="text-sm font-bold text-foreground">History</h3>
					<p className="mt-0.5 text-xs text-muted">
						Everything the orchestrator has done, newest first.
					</p>
				</header>
				<EventLog events={events} isLoading={eventsLoading} showProject />
			</section>

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

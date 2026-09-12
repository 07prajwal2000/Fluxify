import { useState } from "react";
import { Button, Spinner, cn, toast } from "@fluxify/components";
import { TbHistory, TbPlus, TbTopologyStar3 } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ClaimCard } from "@/components/orchestration/ClaimCard";
import { ClaimDialog, type ClaimType } from "@/components/orchestration/ClaimDialog";
import { CONSEQUENCE } from "@/components/orchestration/copy";
import { GroupAlarms } from "@/components/orchestration/GroupAlarms";
import { InfraPanel } from "@/components/orchestration/InfraPanel";
import { NodeHistoryView } from "@/components/orchestration/NodeHistoryView";
import { showErrorNotification } from "@/lib/errorNotifier";
import { orchestrationQuery } from "@/query/orchestrationQuery";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";
import { triggersQuery } from "@/query/triggersQuery";
import type { ClaimView } from "@/services/orchestration";

/**
 * Where a project asks for capacity (§3a).
 *
 * A claim is one workload — what it runs, the trigger groups it serves, and how
 * many identical copies — and a project may hold as many as it needs. What it
 * cannot do here is size the instance: a claim past the operator's ceiling is
 * recorded and left pending, which is the message rather than an error.
 */
export function NodesSettings({ projectId }: { projectId: string }) {
	const { data: publicSettings } = publicSettingsQuery.get.useQuery();
	const available = publicSettings?.orchestration?.enabled !== false;

	const { data: status, isLoading } = orchestrationQuery.project.useQuery(projectId, available);
	const { data: events, isLoading: eventsLoading } = orchestrationQuery.projectEvents.useQuery(
		projectId,
		available,
	);
	const { data: groups } = triggersQuery.groups.useQuery(projectId);

	const claim = orchestrationQuery.claim.useMutation(projectId);
	const update = orchestrationQuery.updateClaim.useMutation(projectId);
	const release = orchestrationQuery.releaseClaim.useMutation(projectId);

	const [editing, setEditing] = useState<ClaimView | "new" | null>(null);
	const [releasing, setReleasing] = useState<ClaimView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"workloads" | "history">("workloads");

	if (!available) {
		return (
			<Empty
				title="This deployment runs a single node"
				body="Nodes are claimed on a production deployment, where a separate orchestrator starts and stops them. This build runs everything in one process, so there is nothing to claim."
			/>
		);
	}
	if (isLoading || !status) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}

	const groupNames = Object.fromEntries((groups ?? []).map((group) => [group.id, group.name]));
	const groupOptions = (groups ?? []).map((group) => ({ id: group.id, name: group.name }));

	function submit(body: { type: ClaimType; groupIds: string[]; replicas: number }) {
		setError(null);
		const onError = (err: unknown) => {
			// The server's refusal is written for this reader — a licence limit, a
			// missing subdomain — so it is shown in the dialog rather than replaced
			// with "something went wrong".
			const message = messageOf(err);
			setError(message);
			showErrorNotification(err as Error);
		};
		if (editing === "new") {
			claim.mutate(body, {
				onSuccess: (result) => {
					toast.success(result.message);
					setEditing(null);
				},
				onError,
			});
			return;
		}
		if (!editing) return;
		update.mutate(
			{ claimId: editing.id, body: body },
			{
				onSuccess: (result) => {
					toast.success(result.message);
					setEditing(null);
				},
				onError,
			},
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="text-xl font-bold tracking-tight">Nodes</h2>
					<p className="mt-0.5 text-sm text-muted-foreground">
						The workers running this project's work. Claim one per workload; a claim is a request,
						so what you asked for and what is running can differ.
					</p>
				</div>
				<Button variant="primary" onPress={() => setEditing("new")}>
					<TbPlus size={16} />
					Claim a workload
				</Button>
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
					Workloads
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

					{status.claims.length === 0 ? (
						<Empty
							title="This project holds no nodes of its own"
							body="Its work runs on the shared nodes below. Claim a workload to give a trigger group nodes of its own."
						/>
					) : (
						status.claims.map((item) => (
							<ClaimCard
								key={item.id}
								claim={item}
								provider={status.orchestrator.provider}
								groupNames={groupNames}
								onChange={() => {
									setError(null);
									setEditing(item);
								}}
								onRelease={() => setReleasing(item)}
							/>
						))
					)}

					{status.sharedClaims.length > 0 && (
						<div className="flex flex-col gap-3">
							<div>
								<h3 className="text-sm font-bold text-foreground">Shared workloads</h3>
								<p className="mt-0.5 text-xs text-muted">
									Claimed for every project, including this one — this is what runs this project's
									work when it holds no nodes of its own. Only an instance operator can change them.
								</p>
							</div>
							{status.sharedClaims.map((item) => (
								// No onChange or onRelease: the card renders read-only without them,
								// which is the whole difference between context and a control.
								<ClaimCard key={item.id} claim={item} provider={status.orchestrator.provider} />
							))}
						</div>
					)}

					{events && events.length > 0 && (
						<div className="flex items-center justify-between rounded-xl border border-border bg-background p-4">
							<div className="flex items-center gap-3">
								<div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted">
									<TbHistory size={18} />
								</div>
								<div>
									<h4 className="text-sm font-semibold text-foreground">Node Activity & History</h4>
									<p className="text-xs text-muted">
										{events.length} lifecycle event{events.length === 1 ? "" : "s"} recorded for this project's nodes.
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
				<NodeHistoryView events={events} isLoading={eventsLoading} />
			)}

			{editing && (
				<ClaimDialog
					isOpen
					status={status}
					groups={groupOptions}
					claim={editing === "new" ? undefined : editing}
					isPending={claim.isPending || update.isPending}
					error={error}
					onClose={() => {
						setEditing(null);
						setError(null);
					}}
					onSubmit={submit}
				/>
			)}

			<ConfirmDialog
				open={releasing !== null}
				onOpenChange={(open) => !open && setReleasing(null)}
				title="Release this workload?"
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

function Empty({ title, body }: { title: string; body: string }) {
	return (
		<div className="rounded-xl border border-border bg-background p-8 text-center">
			<p className="text-sm font-bold text-foreground">{title}</p>
			<p className="mx-auto mt-1 max-w-md text-xs text-muted">{body}</p>
		</div>
	);
}

/** The server's message, which is the part worth showing. */
function messageOf(error: unknown): string {
	const response = (error as { response?: { data?: { message?: string; error?: string } } })
		?.response?.data;
	return response?.message ?? response?.error ?? "That was refused.";
}

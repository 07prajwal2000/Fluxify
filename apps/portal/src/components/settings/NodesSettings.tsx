import { useState } from "react";
import { Button, Spinner, toast } from "@fluxify/components";
import { TbPlus } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ClaimCard } from "@/components/orchestration/ClaimCard";
import { ClaimDialog, type ClaimType } from "@/components/orchestration/ClaimDialog";
import { CONSEQUENCE } from "@/components/orchestration/copy";
import { EventLog } from "@/components/orchestration/EventLog";
import { GroupAlarms } from "@/components/orchestration/GroupAlarms";
import { InfraPanel } from "@/components/orchestration/InfraPanel";
import { NodeList } from "@/components/orchestration/NodeList";
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

			<GroupAlarms alarms={status.alarms} />
			<InfraPanel status={status} />

			{status.claims.length === 0 ? (
				<Empty
					title="This project holds no nodes"
					body="Its workflows run on whichever shared node picks them up. Claim a workload to give a trigger group nodes of its own."
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

			{status.sharedNodes.length > 0 && (
				<section className="overflow-hidden rounded-xl border border-border bg-background">
					<header className="border-b border-border p-4">
						<h3 className="text-sm font-bold text-foreground">Shared nodes</h3>
						<p className="mt-0.5 text-xs text-muted">
							These serve every project, including this one. Only an instance operator can change
							them.
						</p>
					</header>
					<NodeList nodes={status.sharedNodes} provider={status.orchestrator.provider} />
				</section>
			)}

			<section className="overflow-hidden rounded-xl border border-border bg-background">
				<header className="border-b border-border p-4">
					<h3 className="text-sm font-bold text-foreground">History</h3>
					<p className="mt-0.5 text-xs text-muted">
						What has happened to this project's nodes. A node that was removed is only visible here.
					</p>
				</header>
				<EventLog events={events} isLoading={eventsLoading} />
			</section>

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

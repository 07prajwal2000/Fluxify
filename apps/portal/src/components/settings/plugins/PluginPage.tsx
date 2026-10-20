import { Button, DeleteButton, toast } from "@fluxify/components";
import { type ReactNode, useState } from "react";
import { TbArrowLeft, TbRefresh } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { pluginsQuery } from "@/query/pluginsQuery";
import type { Plugin } from "@/services/plugins";
import { ApprovalDialog } from "./ApprovalDialog";
import { ApprovalBadge, isUpgrade, StatusBadge, versionLabel } from "./PluginBadges";
import { PluginInstallStatus } from "./PluginInstallStatus";
import { PluginBlocks, PluginPermissions, PluginProvenance } from "./PluginSummary";
import { PluginUsage } from "./PluginUsage";
import { RemovePluginDialog } from "./RemovePluginDialog";

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<h2 className="text-sm font-semibold text-foreground">{title}</h2>
			{children}
		</section>
	);
}

/**
 * One plugin: what it ships, what it may do, where it came from, how far the
 * workers got installing it, and who uses it. A creator approves, rejects (or
 * cancels a pending upgrade), scans and removes it from here.
 */
export function PluginPage({
	projectId,
	plugin,
	editable,
	onBack,
}: {
	projectId: string;
	plugin: Plugin;
	editable: boolean;
	onBack: () => void;
}) {
	const upgrade = isUpgrade(plugin);
	const reject = pluginsQuery.reject.useMutation(projectId);
	const scan = pluginsQuery.scan.useMutation(projectId);
	const [approving, setApproving] = useState(false);
	const [rejecting, setRejecting] = useState(false);
	const [removing, setRemoving] = useState(false);

	function confirmReject() {
		reject.mutate(plugin.name, {
			onSuccess: () => toast.success(upgrade ? "Upgrade cancelled" : `${plugin.name} rejected`),
			onError: (e) => showErrorNotification(e),
			onSettled: () => setRejecting(false),
		});
	}

	return (
		<div className="flex flex-col gap-6">
			<Button variant="ghost" size="sm" className="self-start" onPress={onBack}>
				<TbArrowLeft size={16} /> All plugins
			</Button>

			<div className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="truncate font-mono text-xl font-semibold tracking-tight">{plugin.name}</h1>
					<div className="flex items-center gap-2 text-sm text-muted">
						{versionLabel(plugin)} <ApprovalBadge plugin={plugin} /> <StatusBadge plugin={plugin} />
					</div>
				</div>
				{editable && (
					<div className="flex shrink-0 gap-2">
						<Button
							variant="outline"
							isPending={scan.isPending}
							onPress={() => scan.mutate(plugin.name, { onError: (e) => showErrorNotification(e) })}
						>
							<TbRefresh size={16} /> Scan now
						</Button>
						{plugin.approval !== "approved" && (
							<>
								{plugin.approval === "pending" && (
									<Button variant="outline" onPress={() => setRejecting(true)}>
										{upgrade ? "Cancel upgrade" : "Reject"}
									</Button>
								)}
								<Button variant="primary" onPress={() => setApproving(true)}>
									{upgrade ? "Review upgrade" : "Review & approve"}
								</Button>
							</>
						)}
						<DeleteButton onPress={() => setRemoving(true)}>Remove</DeleteButton>
					</div>
				)}
			</div>

			{plugin.status === "error" && plugin.lastError && (
				<p
					role="alert"
					className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
				>
					{plugin.lastError}
				</p>
			)}

			<Section title="Blocks">
				<PluginBlocks plugin={plugin} />
			</Section>
			<Section title="Permissions">
				<PluginPermissions plugin={plugin} />
			</Section>
			<Section title="Package">
				<PluginProvenance plugin={plugin} />
			</Section>
			<Section title="Installation on workers">
				<PluginInstallStatus projectId={projectId} name={plugin.name} />
			</Section>
			<Section title="Used by">
				<PluginUsage projectId={projectId} name={plugin.name} />
			</Section>

			<ApprovalDialog
				projectId={projectId}
				plugin={plugin}
				open={approving}
				onOpenChange={setApproving}
			/>
			<ConfirmDialog
				open={rejecting}
				onOpenChange={setRejecting}
				title={upgrade ? `Cancel the upgrade to ${plugin.version}?` : `Reject ${plugin.name}?`}
				confirmText={upgrade ? "Cancel upgrade" : "Reject"}
				danger
				pending={reject.isPending}
				onConfirm={confirmReject}
			>
				{upgrade
					? `Version ${plugin.live?.version} keeps running in development and production. The new version is dropped; upload it again to retry.`
					: "None of its blocks will load. You can approve it later."}
			</ConfirmDialog>
			<RemovePluginDialog
				projectId={projectId}
				name={plugin.name}
				open={removing}
				onOpenChange={setRemoving}
				onRemoved={onBack}
			/>
		</div>
	);
}

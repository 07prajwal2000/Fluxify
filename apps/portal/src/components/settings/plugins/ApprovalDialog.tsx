import { Button, CloseButton, Modal, Spinner, toast } from "@fluxify/components";
import { requestedPermissions } from "@fluxify/server/src/modules/plugins/meta";
import { useState } from "react";
import { TbAlertTriangle } from "react-icons/tb";
import { parseApiError, showErrorNotification } from "@/lib/errorNotifier";
import { pluginsQuery } from "@/query/pluginsQuery";
import { type Plugin, type PluginUpgradeDiff, upgradeBlockedFromError } from "@/services/plugins";
import { isUpgrade } from "./PluginBadges";
import { manifestOf, PluginIntegrations, PluginTriggerKinds } from "./PluginSummary";
import { UpgradeDiff } from "./UpgradeDiff";

function Grants({ plugin }: { plugin: Plugin }) {
	const { integrations, appconfig } = requestedPermissions(manifestOf(plugin));
	const grants = [
		...integrations.map((i) => `Use the ${i} integration`),
		...(appconfig ? ["Read app config"] : []),
	];
	return (
		<section className="flex flex-col gap-1.5">
			<h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
				Approving grants
			</h4>
			{grants.length ? (
				<ul className="list-disc pl-5 text-sm text-foreground">
					{grants.map((g) => (
						<li key={g}>{g}</li>
					))}
				</ul>
			) : (
				<p className="text-sm text-muted">No special permissions.</p>
			)}
		</section>
	);
}

/** The trigger kinds this version ships, which approval switches on with the blocks. */
function TriggerKinds({ plugin }: { plugin: Plugin }) {
	if (!(manifestOf(plugin).triggers ?? []).length) return null;
	return (
		<section className="flex flex-col gap-1.5">
			<h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Trigger kinds</h4>
			<PluginTriggerKinds plugin={plugin} />
		</section>
	);
}

/**
 * Approving lets the version load, with the permissions it asks for. For an
 * upgrade it shows what changes first, and cannot be confirmed while the
 * upgrade takes away something the project uses (the server refuses it too:
 * a 409 carrying the same diff is shown here).
 */
export function ApprovalDialog({
	projectId,
	plugin,
	open,
	onOpenChange,
}: {
	projectId: string;
	plugin: Plugin;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const upgrade = isUpgrade(plugin);
	const preview = pluginsQuery.upgradePreview.useQuery(projectId, plugin.name, open && upgrade);
	const approve = pluginsQuery.approve.useMutation(projectId);
	const [refused, setRefused] = useState<{ message: string; diff: PluginUpgradeDiff }>();

	const diff = refused?.diff ?? preview.data?.diff;
	const blocked = Boolean(diff?.blocking);

	function submit() {
		approve.mutate(
			{ name: plugin.name, integrity: plugin.integrity },
			{
				onSuccess: () => {
					toast.success(`${plugin.name}@${plugin.version} approved`);
					onOpenChange(false);
				},
				onError: (e) => {
					const conflict = upgradeBlockedFromError(e);
					if (conflict) setRefused(conflict);
					else showErrorNotification(e);
				},
			},
		);
	}

	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>
								{upgrade ? "Approve upgrade" : "Approve plugin"} {plugin.name}@{plugin.version}
							</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<Modal.Body>
							<div className="flex flex-col gap-4">
								{upgrade && (
									<div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-foreground">
										<TbAlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
										<p>
											Development and production move together: both switch from{" "}
											{plugin.live?.version} to {plugin.version} at once, and the workers restart
											gracefully, one at a time.
										</p>
									</div>
								)}
								<Grants plugin={plugin} />
								<TriggerKinds plugin={plugin} />
								{((plugin.integrations && plugin.integrations.length > 0) ||
									(manifestOf(plugin) as any)?.integrations?.length > 0) && (
									<section className="flex flex-col gap-1.5">
										<h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
											Integrations provided
										</h4>
										<PluginIntegrations plugin={plugin} />
									</section>
								)}
								{upgrade && preview.isLoading && <Spinner size="sm" />}
								{upgrade && preview.error && (
									<p className="text-xs text-danger">{parseApiError(preview.error).message}</p>
								)}
								{refused && <p className="text-xs text-danger">{refused.message}</p>}
								{diff && <UpgradeDiff diff={diff} projectId={projectId} />}
							</div>
						</Modal.Body>
						<Modal.Footer>
							<Button variant="ghost" onPress={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button
								variant="primary"
								isDisabled={blocked || (upgrade && !diff)}
								isPending={approve.isPending}
								onPress={submit}
							>
								Approve
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

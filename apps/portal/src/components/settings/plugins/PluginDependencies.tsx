import { Button, Spinner, toast } from "@fluxify/components";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { parseApiError, showErrorNotification } from "@/lib/errorNotifier";
import { pluginsQuery } from "@/query/pluginsQuery";
import type { InstallStep, Plugin } from "@/services/plugins";
import { Badge } from "./PluginBadges";

/** the plugins an install brings along, in the order they install */
export function InstallPlanList({ steps }: { steps: InstallStep[] }) {
	return (
		<ul
			aria-label="Plugins to install"
			className="flex flex-col divide-y divide-border rounded-lg border border-border"
		>
			{steps.map((s) => (
				<li key={s.plugin} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
					<span className="min-w-0 truncate font-mono text-foreground">
						{s.name}@{s.version}
					</span>
					{s.from ? (
						<Badge tone="warning">{`Upgrade from ${s.from}`}</Badge>
					) : (
						<Badge tone="muted">New</Badge>
					)}
				</li>
			))}
		</ul>
	);
}

const approvalTone = { approved: "success", pending: "warning", rejected: "danger" } as const;

/**
 * What the plugin depends on (#899), in what state, and what depends on it. A
 * creator installs the missing dependencies from here, after seeing the list.
 */
export function PluginDependencies({
	projectId,
	plugin,
	editable,
}: {
	projectId: string;
	plugin: Plugin;
	editable: boolean;
}) {
	const { dependsOn = [], usedBy = [] } = plugin.dependencies ?? {};
	const [confirming, setConfirming] = useState(false);
	const plan = pluginsQuery.dependencyPlan.useQuery(projectId, plugin.name, confirming);
	const install = pluginsQuery.installDependencies.useMutation(projectId);
	const missing = dependsOn.some((d) => !d.satisfied);

	function confirm() {
		install.mutate(plugin.name, {
			onSuccess: ({ dependencies }) => {
				toast.success(
					`${dependencies.length} ${dependencies.length === 1 ? "plugin" : "plugins"} added, waiting for approval`,
				);
				setConfirming(false);
			},
			onError: (e) => showErrorNotification(e),
		});
	}

	return (
		<div className="flex flex-col gap-6">
			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Depends on</h3>
					{editable && missing && (
						<Button size="sm" variant="outline" onPress={() => setConfirming(true)}>
							Install missing dependencies
						</Button>
					)}
				</div>
				{dependsOn.length ? (
					<ul aria-label="Depends on" className="flex flex-col gap-1.5">
						{dependsOn.map((d) => (
							<li key={d.plugin} className="flex flex-wrap items-center gap-2 text-xs">
								<span className="font-mono text-foreground">{d.plugin}</span>
								<code className="font-mono text-muted">{d.range}</code>
								{!d.installed ? (
									<Badge tone="danger">Not installed</Badge>
								) : !d.satisfied ? (
									<Badge tone="danger">{`${d.installed.version} installed, out of range`}</Badge>
								) : (
									<Badge tone={approvalTone[d.installed.approval]}>
										{`${d.installed.version} ${d.installed.approval}`}
									</Badge>
								)}
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted">No other plugins.</p>
				)}
			</section>
			<section className="flex flex-col gap-2">
				<h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Used by</h3>
				{usedBy.length ? (
					<ul aria-label="Used by plugins" className="flex flex-col gap-1.5">
						{usedBy.map((u) => (
							<li key={u.plugin} className="flex flex-wrap items-center gap-2 text-xs">
								<span className="font-mono text-foreground">
									{u.plugin}@{u.version}
								</span>
								<span className="text-muted">needs {u.range}</span>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted">No plugin depends on it.</p>
				)}
			</section>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title="Install missing dependencies?"
				confirmText="Install"
				pending={install.isPending}
				confirmDisabled={!plan.data?.dependencies.length}
				onConfirm={confirm}
			>
				{plan.isLoading && <Spinner size="sm" />}
				{plan.error && (
					<p role="alert" className="text-xs text-danger">
						{parseApiError(plan.error).message}
					</p>
				)}
				{plan.data && (
					<div className="flex flex-col gap-2">
						<span>Each one is added waiting for approval:</span>
						<InstallPlanList steps={plan.data.dependencies} />
					</div>
				)}
			</ConfirmDialog>
		</div>
	);
}

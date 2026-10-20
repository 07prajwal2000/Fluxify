import { Button, Checkbox } from "@fluxify/components";
import { TbRefresh } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { pluginsQuery } from "@/query/pluginsQuery";
import type { Plugin } from "@/services/plugins";
import {
	ApprovalBadge,
	formatTime,
	isUpgrade,
	SOURCE_LABEL,
	StatusBadge,
	versionLabel,
} from "./PluginBadges";

/** One plugin in the settings list: its state at a glance, the dev/prod switches, and the way into its page. */
export function PluginRow({
	projectId,
	plugin,
	editable,
	onOpen,
}: {
	projectId: string;
	plugin: Plugin;
	editable: boolean;
	onOpen: () => void;
}) {
	const environments = pluginsQuery.setEnvironments.useMutation(projectId);
	const scan = pluginsQuery.scan.useMutation(projectId);

	const toggle = (env: "dev" | "prod", on: boolean) =>
		environments.mutate(
			{
				name: plugin.name,
				envs: {
					dev: env === "dev" ? on : plugin.devEnabled,
					prod: env === "prod" ? on : plugin.prodEnabled,
				},
			},
			{ onError: (e) => showErrorNotification(e) },
		);

	return (
		<div className="flex flex-col gap-2 px-4 py-3">
			<div className="flex items-center justify-between gap-4">
				<div className="flex min-w-0 flex-col">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onOpen}
							className="truncate font-mono text-sm font-medium text-foreground hover:text-accent"
						>
							{plugin.name}
						</button>
						<ApprovalBadge plugin={plugin} />
						<StatusBadge plugin={plugin} />
					</div>
					<span className="text-xs text-muted">
						{versionLabel(plugin)} · {SOURCE_LABEL[plugin.source]} · scanned{" "}
						{formatTime(plugin.scannedAt)}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-4">
					<Checkbox
						aria-label={`Enable ${plugin.name} in development`}
						label="Dev"
						isSelected={plugin.devEnabled}
						isDisabled={!editable || environments.isPending}
						onChange={(on) => toggle("dev", on)}
					/>
					<Checkbox
						aria-label={`Enable ${plugin.name} in production`}
						label="Prod"
						isSelected={plugin.prodEnabled}
						isDisabled={!editable || environments.isPending}
						onChange={(on) => toggle("prod", on)}
					/>
					{editable && (
						<Button
							size="sm"
							variant="outline"
							aria-label={`Scan ${plugin.name} now`}
							isPending={scan.isPending}
							onPress={() => scan.mutate(plugin.name, { onError: (e) => showErrorNotification(e) })}
						>
							<TbRefresh size={14} /> Scan
						</Button>
					)}
					<Button size="sm" variant="ghost" onPress={onOpen}>
						{editable && plugin.approval === "pending" ? "Review" : "Details"}
					</Button>
				</div>
			</div>
			{plugin.status === "error" && plugin.lastError && (
				<p className="text-xs text-danger">{plugin.lastError}</p>
			)}
			{plugin.approval === "pending" && !isUpgrade(plugin) && (
				<p className="text-xs text-muted">Nothing loads until a creator approves it.</p>
			)}
		</div>
	);
}

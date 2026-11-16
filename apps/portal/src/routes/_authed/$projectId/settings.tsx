import { cn } from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
	TbActivityHeartbeat,
	TbAdjustments,
	TbAlertTriangle,
	TbCpu,
	TbDatabaseExport,
	TbFlask,
	TbHistory,
	TbKey,
	TbPackage,
	TbPlug,
	TbTopologyStar3,
	TbUsers,
} from "react-icons/tb";
import { AiConnectionsSettings } from "@/components/settings/AiConnectionsSettings";
import { resolveActiveTab } from "@/components/settings/activeTab";
import { BackupSettings } from "@/components/settings/backup/BackupSettings";
import { type BackupView, parseBackupView } from "@/components/settings/backup/views";
import { DangerZoneSettings } from "@/components/settings/DangerZoneSettings";
import { DevAccessSettings } from "@/components/settings/DevAccessSettings";
import { ExperimentalSettings } from "@/components/settings/ExperimentalSettings";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { MembersSettings } from "@/components/settings/MembersSettings";
import { NodesSettings } from "@/components/settings/NodesSettings";
import { PackagesSettings } from "@/components/settings/PackagesSettings";
import { ProjectAuditSettings } from "@/components/settings/ProjectAuditSettings";
import { PluginsSettings } from "@/components/settings/plugins/PluginsSettings";
import {
	TELEMETRY_SIGNALS,
	TelemetryDestinations,
} from "@/components/settings/TelemetryDestinations";
import { TriggerSettings } from "@/components/settings/TriggerSettings";
import { WorkflowConcurrencySettings } from "@/components/settings/WorkflowConcurrencySettings";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { projectMembersQuery } from "@/query/projectMembersQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { projectsQuery } from "@/query/projectsQuery";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";
import { useAuthStore, useCanEditProject, useIsSystemAdmin } from "@/store/auth";

type SettingsSearch = {
	tab?:
		| "general"
		| "telemetry"
		| "ai-connections"
		| "packages"
		| "plugins"
		| "dev-access"
		| "nodes"
		| "members"
		| "audit-logs"
		| "backup"
		| "experimental"
		| "danger";
	/** the plugin whose page is open on the Plugins tab, as `scope/name` */
	plugin?: string;
	/** the open inner tab of the Backup tab; absent means Back up */
	backupView?: BackupView;
};

export const Route = createFileRoute("/_authed/$projectId/settings")({
	validateSearch: (search: Record<string, unknown>): SettingsSearch => {
		return {
			tab: typeof search.tab === "string" ? (search.tab as SettingsSearch["tab"]) : undefined,
			plugin: typeof search.plugin === "string" ? search.plugin : undefined,
			backupView: parseBackupView(search.backupView),
		};
	},
	head: createRouteHead(
		"Project Settings",
		"Configure general settings, telemetry, AI models, and project members.",
	),
	component: ProjectSettingsPage,
});

const SETTINGS_TABS = [
	{ id: "general", label: "General", icon: TbAdjustments },
	{ id: "telemetry", label: "Telemetry", icon: TbActivityHeartbeat },
	{ id: "ai-connections", label: "AI configuration", icon: TbCpu },
	// Absent on a deployment with no orchestrator (Kit), where there is one node
	// by construction and nothing to claim.
	{ id: "nodes", label: "Nodes", icon: TbTopologyStar3, flag: "orchestration" },
	{ id: "packages", label: "npm Packages", icon: TbPackage },
	{ id: "plugins", label: "Plugins", icon: TbPlug },
	// Creators and above; a viewer does not see it, and the API refuses them too.
	{ id: "dev-access", label: "Development access", icon: TbKey, editorsOnly: true },
	{ id: "members", label: "Members", icon: TbUsers },
	{ id: "audit-logs", label: "Audit logs", icon: TbHistory },
	// Creators and above: an archive holds the whole project, and the API refuses a viewer.
	{ id: "backup", label: "Backup", icon: TbDatabaseExport, editorsOnly: true },
	{ id: "experimental", label: "Experimental", icon: TbFlask },
	// System admins only: the API refuses a project delete to everyone else.
	{ id: "danger", label: "Danger Zone", icon: TbAlertTriangle, systemAdminOnly: true },
] as const;

type TabId = (typeof SETTINGS_TABS)[number]["id"];

function ProjectSettingsPage() {
	const { projectId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/$projectId/settings" });
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Project Settings"));

	const { data: publicSettings } = publicSettingsQuery.get.useQuery();
	const canEdit = useCanEditProject(projectId);
	const isSystemAdmin = useIsSystemAdmin();
	const tabs = SETTINGS_TABS.filter(
		(tab) =>
			(!("flag" in tab) || publicSettings?.orchestration?.enabled !== false) &&
			(!("editorsOnly" in tab) || canEdit) &&
			(!("systemAdminOnly" in tab) || isSystemAdmin),
	);

	// The session is filled in after the first render, so on a refresh the gated
	// tabs aren't in `tabs` yet; judging ?tab= before then bounced it to General.
	const authReady = useAuthStore().userData.id !== "";
	const activeTab: TabId = resolveActiveTab({
		requested: search.tab,
		visible: tabs.map((t) => t.id),
		all: SETTINGS_TABS.map((t) => t.id),
		authReady,
		fallback: "general",
	});
	const gated = SETTINGS_TABS.some(
		(t) => t.id === activeTab && ("editorsOnly" in t || "systemAdminOnly" in t),
	);

	// a gated tab renders nothing until the session says whether this user may see it
	const contentTab = gated && !authReady ? undefined : activeTab;

	useEffect(() => {
		if (authReady && search.tab !== activeTab) {
			navigate({ search: { tab: activeTab } as any, replace: true });
		}
	}, [authReady, search.tab, activeTab, navigate]);

	// For Members badge
	const { data: projectsData } = projectsQuery.getAll.useQuery({ page: 1, perPage: 50 });
	const membersCount = projectsData?.data?.find((p: any) => p.id === projectId)?.totalUsers;

	// For Telemetry badge
	const { data: telemetrySettings } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const configuredTelemetry = TELEMETRY_SIGNALS.filter(
		(s) =>
			(telemetrySettings ?? {})[s.key] ||
			(s.tag === "logs" && (telemetrySettings ?? {})["settings.ai.loggerConnectionId"]),
	).length;

	return (
		<div className="flex h-full w-full flex-col">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">Project settings</h1>
				<p className="text-sm text-muted">Manage your project configurations and settings.</p>
			</div>

			<div className="flex min-h-0 flex-1 rounded-xl border border-border bg-surface">
				{/* Left Sidebar */}
				<div className="w-[240px] shrink-0 border-r border-border py-6 pl-4 pr-3 flex flex-col gap-1">
					<div className="mb-2 px-3 text-xs font-semibold tracking-wider text-muted uppercase">
						Project
					</div>
					{tabs.map((tab) => (
						<button
							key={tab.id}
							type="button"
							onClick={() => navigate({ search: { tab: tab.id } as any, replace: true })}
							className={cn(
								"flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
								activeTab === tab.id
									? "bg-surface-secondary text-foreground"
									: "text-muted hover:bg-surface-secondary hover:text-foreground",
							)}
						>
							<div className="flex items-center gap-3">
								<tab.icon
									size={18}
									className={activeTab === tab.id ? "text-foreground" : "text-muted"}
								/>
								{tab.label}
							</div>
							{tab.id === "telemetry" && configuredTelemetry > 0 && (
								<div className="flex h-5 min-w-5 items-center justify-center rounded bg-surface-secondary px-1 text-[11px] font-medium text-foreground">
									{configuredTelemetry}
								</div>
							)}
							{tab.id === "ai-connections" && (
								<div className="flex h-5 min-w-5 items-center justify-center rounded bg-surface-secondary px-1 text-[11px] font-medium text-foreground">
									1
								</div>
							)}
							{tab.id === "members" && membersCount !== undefined && (
								<div className="flex h-5 min-w-5 items-center justify-center rounded bg-surface-secondary px-1 text-[11px] font-medium text-foreground">
									{membersCount}
								</div>
							)}
						</button>
					))}
				</div>

				{/* Right Content. relative: the pane scrolls, so the hidden inputs, tab
				    indicators and sr-only labels inside it must be positioned against it,
				    not the page, or a long tab stretches the whole document. */}
				<div
					className={cn(
						"relative flex-1",
						activeTab === "ai-connections"
							? "flex flex-col min-h-0 overflow-hidden p-6"
							: "overflow-y-auto p-8",
					)}
				>
					<div
						className={
							activeTab === "ai-connections" ? "flex flex-col min-h-0 flex-1 w-full" : "max-w-4xl"
						}
					>
						{contentTab === "general" && (
							<div className="flex flex-col gap-6">
								<GeneralSettings projectId={projectId} />
								<TriggerSettings projectId={projectId} />
								<WorkflowConcurrencySettings projectId={projectId} />
							</div>
						)}
						{contentTab === "telemetry" && (
							<div className="flex flex-col gap-4">
								<div>
									<h1 className="text-xl font-semibold tracking-tight">Telemetry</h1>
									<p className="text-sm text-muted">
										Pick where this project's telemetry is exported.
									</p>
								</div>
								<TelemetryDestinations projectId={projectId} />
							</div>
						)}
						{contentTab === "nodes" && <NodesSettings projectId={projectId} />}
						{contentTab === "packages" && <PackagesSettings projectId={projectId} />}
						{contentTab === "plugins" && (
							<PluginsSettings
								projectId={projectId}
								selected={search.plugin}
								onSelect={(plugin) =>
									navigate({ search: { tab: "plugins", plugin } as any, replace: true })
								}
							/>
						)}
						{contentTab === "dev-access" && <DevAccessSettings projectId={projectId} />}
						{contentTab === "members" && <MembersSettings projectId={projectId} />}
						{contentTab === "audit-logs" && <ProjectAuditSettings projectId={projectId} />}
						{contentTab === "backup" && (
							<BackupSettings
								projectId={projectId}
								view={search.backupView}
								onViewChange={(backupView) =>
									navigate({
										search: { tab: "backup", backupView } as any,
										replace: true,
									})
								}
							/>
						)}
						{contentTab === "ai-connections" && <AiConnectionsSettings projectId={projectId} />}
						{contentTab === "experimental" && <ExperimentalSettings projectId={projectId} />}
						{contentTab === "danger" && (
							<DangerZoneSettings projectId={projectId} onDeleted={() => navigate({ to: "/" })} />
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

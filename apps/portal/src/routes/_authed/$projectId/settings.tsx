import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "@fluxify/components";
import { 
	TbAdjustments,
	TbActivityHeartbeat,
	TbCpu,
	TbUsers,
	TbFlask,
	TbAlertTriangle 
} from "react-icons/tb";
import { projectMembersQuery } from "@/query/projectMembersQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { projectsQuery } from "@/query/projectsQuery";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { MembersSettings } from "@/components/settings/MembersSettings";
import { TelemetryDestinations, TELEMETRY_SIGNALS } from "@/components/settings/TelemetryDestinations";
import { DangerZoneSettings } from "@/components/settings/DangerZoneSettings";
import { AiConnectionsSettings } from "@/components/settings/AiConnectionsSettings";
import { ExperimentalSettings } from "@/components/settings/ExperimentalSettings";
import { createRouteHead } from "@/lib/seo";

type SettingsSearch = {
	tab?: "general" | "telemetry" | "ai-connections" | "members" | "experimental" | "danger";
};

export const Route = createFileRoute("/_authed/$projectId/settings")({
	validateSearch: (search: Record<string, unknown>): SettingsSearch => {
		return {
			tab: typeof search.tab === "string" ? (search.tab as SettingsSearch["tab"]) : undefined,
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
	{ id: "ai-connections", label: "AI Connections", icon: TbCpu },
	{ id: "members", label: "Members", icon: TbUsers },
	{ id: "experimental", label: "Experimental", icon: TbFlask },
	{ id: "danger", label: "Danger Zone", icon: TbAlertTriangle },
] as const;

type TabId = typeof SETTINGS_TABS[number]["id"];

function ProjectSettingsPage() {
	const { projectId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/$projectId/settings" });
	
	const validTabs = SETTINGS_TABS.map((t) => t.id);
	const activeTab: TabId = validTabs.includes(search.tab as any) 
		? (search.tab as TabId) 
		: "general";

	useEffect(() => {
		if (search.tab !== activeTab) {
			navigate({ search: { tab: activeTab } as any, replace: true });
		}
	}, [search.tab, activeTab, navigate]);

	// For Members badge
	const { data: projectsData } = projectsQuery.getAll.useQuery({ page: 1, perPage: 50 });
	const membersCount = projectsData?.data?.find((p: any) => p.id === projectId)?.totalUsers;

	// For Telemetry badge
	const { data: telemetrySettings } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const configuredTelemetry = TELEMETRY_SIGNALS.filter(
		(s) => (telemetrySettings ?? {})[s.key] || (s.tag === "logs" && (telemetrySettings ?? {})["settings.ai.loggerConnectionId"])
	).length;

	return (
		<div className="flex h-full w-full flex-col">
			<div className="mb-6">
				<h1 className="text-2xl font-semibold tracking-tight text-white">Project settings</h1>
				<p className="text-sm text-muted">Manage your project configurations and settings.</p>
			</div>

			<div className="flex min-h-0 flex-1 rounded-xl border border-[#161820] bg-[#0A0C10]">
				{/* Left Sidebar */}
				<div className="w-[240px] shrink-0 border-r border-[#161820] py-6 pl-4 pr-3 flex flex-col gap-1">
					<div className="mb-2 px-3 text-xs font-semibold tracking-wider text-zinc-500 uppercase">
						Project
					</div>
					{SETTINGS_TABS.map((tab) => (
						<button
							key={tab.id}
							type="button"
							onClick={() => navigate({ search: { tab: tab.id } as any, replace: true })}
							className={cn(
								"flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
								activeTab === tab.id
									? "bg-[#161820] text-white"
									: "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
							)}
						>
							<div className="flex items-center gap-3">
								<tab.icon size={18} className={activeTab === tab.id ? "text-zinc-300" : "text-zinc-500"} />
								{tab.label}
							</div>
							{tab.id === "telemetry" && configuredTelemetry > 0 && (
								<div className="flex h-5 min-w-5 items-center justify-center rounded bg-[#202533] px-1 text-[11px] font-medium text-zinc-300">
									{configuredTelemetry}
								</div>
							)}
							{tab.id === "ai-connections" && (
								<div className="flex h-5 min-w-5 items-center justify-center rounded bg-[#202533] px-1 text-[11px] font-medium text-zinc-300">
									1
								</div>
							)}
							{tab.id === "members" && membersCount !== undefined && (
								<div className="flex h-5 min-w-5 items-center justify-center rounded bg-[#202533] px-1 text-[11px] font-medium text-zinc-300">
									{membersCount}
								</div>
							)}
						</button>
					))}
				</div>

				{/* Right Content */}
				<div className="flex-1 overflow-y-auto p-8">
					<div className="max-w-4xl">
						{activeTab === "general" && <GeneralSettings projectId={projectId} />}
						{activeTab === "telemetry" && (
							<div className="flex flex-col gap-4">
								<div>
									<h1 className="text-xl font-semibold tracking-tight">Telemetry</h1>
									<p className="text-sm text-muted">Pick where this project's telemetry is exported.</p>
								</div>
								<TelemetryDestinations projectId={projectId} />
							</div>
						)}
						{activeTab === "members" && <MembersSettings projectId={projectId} />}
						{activeTab === "ai-connections" && <AiConnectionsSettings projectId={projectId} />}
						{activeTab === "experimental" && <ExperimentalSettings projectId={projectId} />}
						{activeTab === "danger" && <DangerZoneSettings projectId={projectId} />}
					</div>
				</div>
			</div>
		</div>
	);
}

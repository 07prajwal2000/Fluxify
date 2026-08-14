import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Button, Spinner, cn, toast } from "@fluxify/components";
import { FaRobot, FaTableList } from "react-icons/fa6";
import { LuServerCrash } from "react-icons/lu";
import {
	TbBook,
	TbChevronDown,
	TbCloudCog,
	TbDatabase,
	TbExternalLink,
	TbHeartRateMonitor,
	TbLock,
	TbPlugConnected,
} from "react-icons/tb";
import { integrationsQuery } from "@/query/integrationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { integrationIcons } from "@fluxify/components";
import { IntegrationForm } from "@/components/integrations/IntegrationForm";
import { IntegrationOnboardingModal } from "@/components/integrations/IntegrationOnboardingModal";
import {
	type IntegrationGroup,
	useIntegrationActions,
	useIntegrationState,
} from "@/store/integration";
import { createDynamicRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId/integrations")({
	validateSearch: z.object({
		group: z.string().optional(),
		open: z.string().optional(),
	}),
	head: createDynamicRouteHead(({ search }) => {
		const groupLabels: Record<string, string> = {
			database: "Databases",
			kv: "KV Stores",
			ai: "AI Models",
			baas: "BaaS",
			observability: "Observability",
		};
		const category = search.group ? groupLabels[search.group] || search.group : "All";
		return {
			title: `Integrations (${category})`,
			description: "Connect databases, AI models, KV stores, and third-party services.",
		};
	}),
	component: IntegrationsPage,
});

const CONNECTORS: { name: string; type: IntegrationGroup; icon: ReactNode }[] = [
	{ name: "Databases", type: "database", icon: <TbDatabase size={18} /> },
	{ name: "KV", type: "kv", icon: <FaTableList size={16} /> },
	{ name: "AI", type: "ai", icon: <FaRobot size={16} /> },
	{ name: "BaaS", type: "baas", icon: <LuServerCrash size={16} /> },
	{ name: "Observability", type: "observability", icon: <TbHeartRateMonitor size={18} /> },
];

function IntegrationsPage() {
	const { projectId } = Route.useParams();
	const { group } = Route.useSearch();
	const navigate = useNavigate();
	const { selectedMenu } = useIntegrationState();
	const { setSelectedMenu } = useIntegrationActions();
	const [connectOpen, setConnectOpen] = useState(false);

	// Fetch count of integrations per category
	const { data: dbData } = integrationsQuery.getAll.useQuery(projectId, "database");
	const { data: kvData } = integrationsQuery.getAll.useQuery(projectId, "kv");
	const { data: aiData } = integrationsQuery.getAll.useQuery(projectId, "ai");
	const { data: baasData } = integrationsQuery.getAll.useQuery(projectId, "baas");
	const { data: obsData } = integrationsQuery.getAll.useQuery(projectId, "observability");

	const counts: Record<IntegrationGroup, number> = {
		database: dbData?.length ?? 0,
		kv: kvData?.length ?? 0,
		ai: aiData?.length ?? 0,
		baas: baasData?.length ?? 0,
		observability: obsData?.length ?? 0,
	};

	// sync selected group from URL (deep-link support)
	useEffect(() => {
		if (group && group !== selectedMenu) setSelectedMenu(group as IntegrationGroup);
	}, [group]);

	function selectGroup(type: IntegrationGroup) {
		setSelectedMenu(type);
		navigate({ to: ".", search: { group: type } });
	}

	return (
		<div className="flex h-full flex-col gap-6 overflow-hidden">
			{/* Header */}
			<div className="flex shrink-0 items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-foreground">Integrations</h1>
					<p className="text-sm text-muted">Connect &amp; Configure 3rd Party Services</p>
				</div>
				<Button
					variant="primary"
					onPress={() => setConnectOpen(true)}
				>
					<TbPlugConnected size={16} /> Connect App / Service
				</Button>
			</div>

			<div className="flex min-h-0 flex-1 gap-6 overflow-hidden">
				{/* Column 1 — CATEGORIES Rail */}
				<nav className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto pr-1">
					<div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-muted">
						CATEGORIES
					</div>
					{CONNECTORS.map((c) => {
						const active = selectedMenu === c.type;
						const count = counts[c.type] ?? 0;
						return (
							<button
								key={c.type}
								type="button"
								onClick={() => selectGroup(c.type)}
								className={cn(
									"flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all",
									active
										? "border-border bg-surface text-foreground shadow-sm"
										: "border-transparent text-muted hover:bg-surface-secondary hover:text-foreground",
								)}
							>
								<span className={cn(active ? "text-accent" : "text-muted")}>{c.icon}</span>
								<span>{c.name}</span>
								<span
									className={cn(
										"ml-auto rounded-full px-2 py-0.5 text-xs font-semibold",
										active ? "bg-surface-secondary text-foreground" : "bg-surface-secondary text-muted",
									)}
								>
									{count}
								</span>
							</button>
						);
					})}
				</nav>

				{/* Column 2 — Center configured list or active creation/editing */}
				<div className="min-w-0 flex-1 overflow-y-auto pr-2">
					<IntegrationsList projectId={projectId} group={selectedMenu} />
				</div>

				{/* Column 3 — Right Panel: Help, Connected Databases & Environment Notice */}
				<RightHelpPanel projectId={projectId} activeGroup={selectedMenu} />
			</div>

			<IntegrationOnboardingModal projectId={projectId} isOpen={connectOpen} onOpenChange={setConnectOpen} />
		</div>
	);
}

function IntegrationsList({ projectId, group }: { projectId: string; group: string }) {
	const { open } = Route.useSearch();
	const navigate = useNavigate();
	const { data, isLoading, isError } = integrationsQuery.getAll.useQuery(projectId, group);
	const remove = integrationsQuery.remove.mutation(projectId);

	if (isLoading) return <div className="flex justify-center py-16"><Spinner /></div>;
	if (isError) return <p className="py-16 text-center text-muted">Couldn't load integrations.</p>;

	if (!data || data.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-8 text-center">
				<TbCloudCog size={36} className="text-muted" />
				<div>
					<p className="text-base font-semibold text-foreground">No integrations found</p>
					<p className="mt-1 text-xs text-muted">
						No configured services in this category yet. Click "Connect App / Service" to add one.
					</p>
				</div>
			</div>
		);
	}

	function toggle(id: string) {
		navigate({ to: ".", search: { group, open: open === id ? undefined : id } });
	}

	return (
		<div className="flex flex-col gap-4">
			{data.map((integration) => {
				const isOpen = open === integration.id || data.length === 1;
				return (
					<div
						key={integration.id}
						className="overflow-hidden rounded-2xl border border-border bg-surface transition-all"
					>
						{/* Card Header Bar — Contains Title, ID, & Chevron */}
						<div
							role="button"
							tabIndex={0}
							onClick={() => toggle(integration.id)}
							onKeyDown={(e) => e.key === "Enter" && toggle(integration.id)}
							className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 hover:bg-surface-secondary cursor-pointer"
						>
							<div className="flex items-center gap-3">
								<div className="flex size-9 items-center justify-center rounded-xl bg-surface-secondary text-accent">
									{integrationIcons[integration.variant] ?? <TbDatabase size={18} />}
								</div>
								<div>
									<div className="flex items-center gap-2">
										<span className="font-semibold text-foreground">{integration.name}</span>
									</div>
									<div className="text-xs text-muted">
										{integration.variant} • {group}
									</div>
								</div>
							</div>

							{/* Right Actions Bar — Available even when accordion is closed */}
							<div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
								<span className="rounded-full border border-border bg-surface-secondary px-2.5 py-1 text-[11px] font-mono text-muted">
									ID: {integration.id.slice(0, 8)}
								</span>

								{/* Chevron indicator */}
								<button
									type="button"
									onClick={() => toggle(integration.id)}
									className="p-1 text-muted hover:text-foreground"
								>
									<TbChevronDown
										size={18}
										className={cn("transition-transform", isOpen && "rotate-180")}
									/>
								</button>
							</div>
						</div>

						{/* Form Content */}
						{isOpen && (
							<div className="p-5">
								<IntegrationForm
									projectId={projectId}
									id={integration.id}
									lockGroupVariant
									showDelete
									deletePending={remove.isPending}
									onDelete={() => {
										remove.mutate(integration.id, {
											onSuccess: () => {
												toast.success("Integration deleted");
												navigate({ to: ".", search: { group } });
											},
											onError: (e) => showErrorNotification(e as Error),
										});
									}}
									onSaved={() => navigate({ to: ".", search: { group } })}
								/>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

const HELP_DATA: Record<
	string,
	{
		title: string;
		description: string;
		docsUrl: string;
		tip: string;
		tipIcon?: ReactNode;
	}
> = {
	database: {
		title: "Database Integrations",
		description:
			"Learn how to connect and secure your PostgreSQL, MySQL, and MongoDB databases with SSL and connection pooling.",
		docsUrl: "https://docs.fluxify.rest/integrations/databases.html",
		tip: "Use a dedicated read-only role or restricted database user for Fluxify to limit blast radius.",
		tipIcon: <TbLock size={16} className="shrink-0 text-muted mt-0.5" />,
	},
	kv: {
		title: "KV & Cache Stores",
		description:
			"Configure Redis and Memcached key-value stores for lightning-fast caching, rate-limiting, and state management.",
		docsUrl: "https://docs.fluxify.rest/integrations/kv-stores.html",
		tip: "Prefix cache keys with project namespaces to prevent collisions across environments.",
		tipIcon: <FaTableList size={14} className="shrink-0 text-muted mt-0.5" />,
	},
	ai: {
		title: "AI & LLM Services",
		description:
			"Connect OpenAI, Anthropic, Gemini, Mistral, and local or custom OpenAI-compatible endpoints to your workflow.",
		docsUrl: "https://docs.fluxify.rest/integrations/ai-models.html",
		tip: "Store API keys as encrypted variables in App Config and bind them using cfg: keys.",
		tipIcon: <FaRobot size={14} className="shrink-0 text-muted mt-0.5" />,
	},
	observability: {
		title: "Observability & Telemetry",
		description:
			"Stream structured application logs and real-time telemetry metrics directly to Loki or OpenTelemetry endpoints.",
		docsUrl: "https://docs.fluxify.rest/integrations/observability.html",
		tip: "Use OpenTelemetry (OTLP) to unify logs, metrics, and trace export across your stack.",
		tipIcon: <TbHeartRateMonitor size={16} className="shrink-0 text-muted mt-0.5" />,
	},
	baas: {
		title: "Backend Services",
		description:
			"Connect managed backend services and APIs to trigger events and sync data with your Fluxify projects.",
		docsUrl: "https://docs.fluxify.rest/integrations/databases.html",
		tip: "Ensure all service endpoints and tokens are secured via App Config secrets.",
		tipIcon: <LuServerCrash size={15} className="shrink-0 text-muted mt-0.5" />,
	},
};

function RightHelpPanel({ activeGroup }: { projectId: string; activeGroup: string }) {
	const info = HELP_DATA[activeGroup] ?? HELP_DATA.database;

	return (
		<div className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto pr-1">
			{/* Need Help Card */}
			<div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
				<div className="flex items-center gap-2 font-semibold text-foreground text-sm">
					<TbBook size={16} className="text-muted" />
					<span>Need help?</span>
				</div>
				<p className="text-xs text-muted leading-relaxed">
					{info.description}
				</p>
				<a
					href={info.docsUrl}
					target="_blank"
					rel="noreferrer"
					className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
				>
					View docs <TbExternalLink size={12} />
				</a>
				<div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface-secondary p-3 text-xs text-muted leading-relaxed">
					{info.tipIcon}
					<span>{info.tip}</span>
				</div>
			</div>
		</div>
	);
}

import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Spinner, cn, toast } from "@fluxify/components";
import { FaRobot, FaTableList } from "react-icons/fa6";
import { LuServerCrash } from "react-icons/lu";
import {
	TbBolt,
	TbBook,
	TbChevronDown,
	TbCloudCog,
	TbDatabase,
	TbDots,
	TbExternalLink,
	TbHeartRateMonitor,
	TbLock,
	TbPlugConnected,
	TbTrash,
} from "react-icons/tb";
import { integrationsQuery } from "@/query/integrationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { integrationIcons } from "@fluxify/components";
import { IntegrationForm } from "@/components/integrations/IntegrationForm";
import { IntegrationOnboardingModal } from "@/components/integrations/IntegrationOnboardingModal";
import {
	type IntegrationGroup,
	useIntegrationActions,
	useIntegrationState,
} from "@/store/integration";

export const Route = createFileRoute("/_authed/$projectId/integrations")({
	validateSearch: z.object({
		group: z.string().optional(),
		open: z.string().optional(),
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
		<div className="flex flex-col gap-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-white">Integrations</h1>
					<p className="text-sm text-zinc-400">Connect &amp; Configure 3rd Party Services</p>
				</div>
				<button
					type="button"
					onClick={() => setConnectOpen(true)}
					className="flex items-center gap-2 rounded-xl bg-[#D0F237] px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#bce028]"
				>
					<TbPlugConnected size={16} /> Connect App / Service
				</button>
			</div>

			<div className="flex min-h-0 flex-1 gap-6">
				{/* Column 1 — CATEGORIES Rail */}
				<nav className="flex w-56 shrink-0 flex-col gap-1">
					<div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
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
									"flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
									active
										? "border border-[#202533] bg-[#13151D] text-white shadow-sm"
										: "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200",
								)}
							>
								<span className={cn(active ? "text-[#D0F237]" : "text-zinc-400")}>{c.icon}</span>
								<span>{c.name}</span>
								<span
									className={cn(
										"ml-auto rounded-full px-2 py-0.5 text-xs font-semibold",
										active ? "bg-[#202533] text-zinc-200" : "bg-[#161822] text-zinc-500",
									)}
								>
									{count}
								</span>
							</button>
						);
					})}
				</nav>

				{/* Column 2 — Center configured list or active creation/editing */}
				<div className="min-w-0 flex-1 overflow-y-auto">
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
	const test = integrationsQuery.testConnection.mutation(projectId);

	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

	if (isLoading) return <div className="flex justify-center py-16"><Spinner /></div>;
	if (isError) return <p className="py-16 text-center text-muted">Couldn't load integrations.</p>;

	if (!data || data.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 rounded-2xl border border-[#1C202B] bg-[#0E1015] p-8 text-center">
				<TbCloudCog size={36} className="text-zinc-600" />
				<div>
					<p className="text-base font-semibold text-white">No integrations found</p>
					<p className="mt-1 text-xs text-zinc-400">
						No configured services in this category yet. Click "Connect App / Service" to add one.
					</p>
				</div>
			</div>
		);
	}

	function toggle(id: string) {
		navigate({ to: ".", search: { group, open: open === id ? undefined : id } });
	}

	function handleTest(e: React.MouseEvent, integration: NonNullable<typeof data>[number]) {
		e.stopPropagation();
		test.mutate(
			{ group: integration.group, variant: integration.variant, config: integration.config as Record<string, unknown> },
			{
				onSuccess: (res) =>
					res?.success ? toast.success("Connection successful") : toast.danger(res?.error ?? "Connection failed"),
				onError: (err) => showErrorNotification(err as Error),
			},
		);
	}

	function handleDelete(e: React.MouseEvent, id: string) {
		e.stopPropagation();
		setPendingDeleteId(id);
	}

	return (
		<div className="flex flex-col gap-4">
			{data.map((integration) => {
				const isOpen = open === integration.id || data.length === 1;
				return (
					<div
						key={integration.id}
						className="overflow-hidden rounded-2xl border border-[#1C202B] bg-[#0E1015] transition-all"
					>
						{/* Card Header Bar — Contains Title, ID, Test Connection, Delete, & Chevron */}
						<div
							role="button"
							tabIndex={0}
							onClick={() => toggle(integration.id)}
							onKeyDown={(e) => e.key === "Enter" && toggle(integration.id)}
							className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1C202B] px-5 py-4 hover:bg-white/[0.02] cursor-pointer"
						>
							<div className="flex items-center gap-3">
								<div className="flex size-9 items-center justify-center rounded-xl bg-[#161822] text-[#D0F237]">
									{integrationIcons[integration.variant] ?? <TbDatabase size={18} />}
								</div>
								<div>
									<div className="flex items-center gap-2">
										<span className="font-semibold text-white">{integration.name}</span>
									</div>
									<div className="text-xs text-zinc-400">
										{integration.variant} • {group}
									</div>
								</div>
							</div>

							{/* Right Actions Bar — Available even when accordion is closed */}
							<div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
								<span className="rounded-full border border-[#252A38] bg-[#191C26] px-2.5 py-1 text-[11px] font-mono text-zinc-400">
									ID: {integration.id.slice(0, 8)}
								</span>

								{/* Test Connection Button */}
								<button
									type="button"
									onClick={(e) => handleTest(e, integration)}
									className="flex items-center gap-1.5 rounded-xl border border-[#252A38] bg-[#141720] px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-[#1C202B]"
								>
									<TbBolt size={14} className="text-[#D0F237]" />
									<span>Test Connection</span>
								</button>

								{/* Delete Button */}
								<button
									type="button"
									onClick={(e) => handleDelete(e, integration.id)}
									className="flex items-center justify-center rounded-xl border border-red-900/30 bg-[#1C181B] p-2 text-red-400 transition-colors hover:bg-red-950/40"
									aria-label="Delete integration"
								>
									<TbTrash size={15} />
								</button>

								{/* Chevron indicator */}
								<button
									type="button"
									onClick={() => toggle(integration.id)}
									className="p-1 text-zinc-400 hover:text-white"
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
									showDelete={false}
									onSaved={() => navigate({ to: ".", search: { group } })}
								/>
							</div>
						)}
					</div>
				);
			})}

			<ConfirmDialog
				open={!!pendingDeleteId}
				onOpenChange={(o) => !o && setPendingDeleteId(null)}
				title="Delete integration?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingDeleteId) return;
					const id = pendingDeleteId;
					setPendingDeleteId(null);
					navigate({ to: ".", search: { group } });
					remove.mutate(id, {
						onSuccess: () => toast.success("Integration deleted"),
						onError: (e) => showErrorNotification(e as Error),
					});
				}}
			>
				You are about to delete this integration. This action is irreversible.
			</ConfirmDialog>
		</div>
	);
}

function RightHelpPanel({ projectId, activeGroup }: { projectId: string; activeGroup: string }) {
	const { data: dbData } = integrationsQuery.getAll.useQuery(projectId, "database");

	return (
		<div className="flex w-64 shrink-0 flex-col gap-4">
			{/* Card 1: Need Help */}
			<div className="flex flex-col gap-3 rounded-2xl border border-[#1C202B] bg-[#0E1015] p-4">
				<div className="flex items-center gap-2 font-semibold text-white text-sm">
					<TbBook size={16} className="text-zinc-400" />
					<span>Need help?</span>
				</div>
				<p className="text-xs text-zinc-400 leading-relaxed">
					Learn how to secure your Postgres integration with IP allowlists and read replicas.
				</p>
				<a
					href="https://docs.fluxify.rest/integrations/databases.html"
					target="_blank"
					rel="noreferrer"
					className="flex items-center gap-1 text-xs font-semibold text-[#D0F237] hover:underline"
				>
					View docs <TbExternalLink size={12} />
				</a>
				<div className="flex items-start gap-2.5 rounded-xl border border-[#202533] bg-[#12141C] p-3 text-xs text-zinc-400 leading-relaxed">
					<TbLock size={16} className="shrink-0 text-zinc-400 mt-0.5" />
					<span>Use a dedicated read-only role for Fluxify to limit blast radius.</span>
				</div>
			</div>
		</div>
	);
}

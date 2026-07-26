import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Button, Input, Modal, Spinner, cn, toast } from "@fluxify/components";
import { FaRobot, FaTableList, FaChevronRight } from "react-icons/fa6";
import { LuServerCrash } from "react-icons/lu";
import {
	TbDatabase,
	TbHeartRateMonitor,
	TbPlugConnected,
	TbFilter,
	TbChevronDown,
} from "react-icons/tb";
import {
	getIntegrationsVariants,
	humanReadableConnectorNames,
} from "@fluxify/server/src/api/v1/integrations/helpers";
import { integrationsQuery } from "@/query/integrationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { integrationIcons } from "@/components/integrations/integrationIcons";
import { IntegrationForm } from "@/components/integrations/IntegrationForm";
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
	{ name: "KV", type: "kv", icon: <FaTableList size={18} /> },
	{ name: "AI", type: "ai", icon: <FaRobot size={18} /> },
	{ name: "BaaS", type: "baas", icon: <LuServerCrash size={18} /> },
	{ name: "Observability", type: "observability", icon: <TbHeartRateMonitor size={18} /> },
];

function IntegrationsPage() {
	const { projectId } = Route.useParams();
	const { group } = Route.useSearch();
	const navigate = useNavigate();
	const { selectedMenu } = useIntegrationState();
	const { setSelectedMenu } = useIntegrationActions();
	const [connectOpen, setConnectOpen] = useState(false);

	// sync selected group from URL (deep-link support)
	useEffect(() => {
		if (group && group !== selectedMenu) setSelectedMenu(group as IntegrationGroup);
	}, [group]);

	function selectGroup(type: IntegrationGroup) {
		setSelectedMenu(type);
		navigate({ to: ".", search: { group: type } });
	}

	return (
		<div className="flex h-full flex-col gap-4 px-1 py-1">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
					<p className="text-sm text-muted">Connect &amp; Configure 3rd Party Services</p>
				</div>
				<Button variant="primary" onPress={() => setConnectOpen(true)}>
					<TbPlugConnected size={16} /> Connect App/Service
				</Button>
			</div>

			<div className="flex min-h-0 flex-1 gap-4">
				{/* Left rail — available connectors */}
				<nav className="flex w-56 shrink-0 flex-col gap-1">
					{CONNECTORS.map((c) => {
						const active = selectedMenu === c.type;
						return (
							<button
								key={c.type}
								type="button"
								onClick={() => selectGroup(c.type)}
								className={cn(
									"flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
									active
										? "bg-white/5 text-foreground"
										: "text-muted hover:bg-white/5 hover:text-foreground",
								)}
							>
								<span className={cn(active && "text-accent")}>{c.icon}</span>
								{c.name}
							</button>
						);
					})}
				</nav>

				{/* Center — configured integrations list */}
				<div className="min-w-0 flex-1 overflow-y-auto">
					<IntegrationsList projectId={projectId} group={selectedMenu} />
				</div>

				{/* Right — filter */}
				<FilterPanel group={selectedMenu} />
			</div>

			{/* Connect modal (create) */}
			<Modal isOpen={connectOpen} onOpenChange={setConnectOpen}>
				<Modal.Backdrop>
					<Modal.Container placement="center" size="lg">
						<Modal.Dialog>
							<Modal.Header>
								<Modal.Heading>Connect a new App/Service</Modal.Heading>
							</Modal.Header>
							<Modal.Body>
								<IntegrationForm projectId={projectId} onSaved={() => setConnectOpen(false)} />
							</Modal.Body>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</div>
	);
}

function IntegrationsList({ projectId, group }: { projectId: string; group: string }) {
	const { open } = Route.useSearch();
	const navigate = useNavigate();
	const { filterVariant, searchQuery } = useIntegrationState();
	const { setFilterVariant, setSearchQuery } = useIntegrationActions();
	const { data, isLoading, isError } = integrationsQuery.getAll.useQuery(projectId, group);
	const remove = integrationsQuery.remove.mutation(projectId);

	// reset filters when group changes
	useEffect(() => {
		setFilterVariant("");
		setSearchQuery("");
	}, [group]);

	const filtered = useMemo(() => {
		if (!data) return [];
		if (filterVariant) return data.filter((i) => i.variant === filterVariant);
		if (searchQuery)
			return data.filter((i) => i.name.toLowerCase().includes(searchQuery.toLowerCase()));
		return data;
	}, [data, filterVariant, searchQuery]);

	if (isLoading) return <div className="flex justify-center py-16"><Spinner /></div>;
	if (isError) return <p className="py-16 text-center text-muted">Couldn't load integrations.</p>;

	if (filtered.length === 0) {
		return (
			<div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-background-secondary py-16 text-center">
				<p className="text-lg font-medium">No integrations found.</p>
				<p className="text-sm text-muted">
					{filterVariant || searchQuery
						? "No results found"
						: "Try adding one now by clicking Connect App/Service"}
				</p>
			</div>
		);
	}

	function toggle(id: string) {
		navigate({ to: ".", search: { group, open: open === id ? undefined : id } });
	}

	return (
		<div className="flex flex-col gap-2">
			{filtered.map((integration) => {
				const isOpen = open === integration.id;
				return (
					<div key={integration.id} className="overflow-hidden rounded-lg border border-border bg-background-secondary">
						<button
							type="button"
							onClick={() => toggle(integration.id)}
							className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-white/5"
						>
							<span className="flex items-center gap-3">
								<span className="text-muted">{integrationIcons[integration.variant]}</span>
								<span className="font-medium">{integration.name}</span>
							</span>
							<TbChevronDown size={16} className={cn("text-muted transition-transform", isOpen && "rotate-180")} />
						</button>
						{isOpen && (
							<div className="border-t border-border px-4 py-4">
								<IntegrationForm
									projectId={projectId}
									id={integration.id}
									lockGroupVariant
									showDelete
									deletePending={remove.isPending}
									onDelete={() => {
										// collapse first (drops ?open= and unmounts getById) so the
										// broad invalidation below never refetches the deleted id.
										navigate({ to: ".", search: { group } });
										remove.mutate(integration.id, {
											onSuccess: () => toast.success("Integration deleted"),
											onError: (e) => showErrorNotification(e as Error),
										});
									}}
								/>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}

function FilterPanel({ group }: { group: string }) {
	const { filterVariant, searchQuery, filterHidden } = useIntegrationState();
	const { setFilterVariant, setSearchQuery, toggleFilterVisibility } = useIntegrationActions();
	const hasFilter = !!filterVariant || !!searchQuery;

	if (filterHidden) {
		return (
			<div className="shrink-0 pt-1">
				<button
					type="button"
					onClick={toggleFilterVisibility}
					className="relative rounded-md p-2 text-muted hover:bg-white/5 hover:text-foreground"
					aria-label="Show filters"
				>
					<TbFilter size={16} />
					{hasFilter && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-danger" />}
				</button>
			</div>
		);
	}

	return (
		<div className="w-56 shrink-0">
			<div className="flex flex-col gap-3 rounded-lg border border-border bg-background-secondary p-3">
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">Filter Integrations</span>
					<button
						type="button"
						onClick={toggleFilterVisibility}
						className="rounded-md p-1 text-muted hover:bg-white/5 hover:text-foreground"
						aria-label="Hide filters"
					>
						<FaChevronRight size={13} />
					</button>
				</div>
				<div className="flex flex-col gap-1">
					<label className="text-xs text-muted">Search</label>
					<Input value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)} placeholder="Search..." />
				</div>
				<div className="flex flex-col gap-1">
					<label className="text-xs text-muted">By type</label>
					<select
						value={filterVariant}
						onChange={(e) => setFilterVariant(e.target.value)}
						className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none"
					>
						<option value="">All types</option>
						{getIntegrationsVariants(group as never).map((v) => (
							<option key={v} value={v}>{v}</option>
						))}
					</select>
				</div>
			</div>
		</div>
	);
}

import { Button, Chip, cn, Spinner, Table } from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo } from "react";
import { FaRobot, FaTableList } from "react-icons/fa6";
import { LuServerCrash } from "react-icons/lu";
import {
	TbArrowsExchange,
	TbBook,
	TbCloudCog,
	TbDatabase,
	TbExternalLink,
	TbHeartRateMonitor,
	TbLock,
	TbPlug,
	TbPlugConnected,
	TbServer,
} from "react-icons/tb";
import { VscMcp } from "react-icons/vsc";
import { z } from "zod";
import { pluginFolderIcon } from "@/components/canvas/plugins/pluginFolderIcon";
import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import { IntegrationTestButtons } from "@/components/integrations/IntegrationTestButtons";
import { IntegrationVariantIcon } from "@/components/integrations/IntegrationVariantIcon";
import { createDynamicRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { integrationsQuery, useIntegrationCatalog } from "@/query/integrationsQuery";
import { projectsQuery } from "@/query/projectsQuery";
import {
	type IntegrationGroup,
	useIntegrationActions,
	useIntegrationState,
} from "@/store/integration";

export const Route = createFileRoute("/_authed/$projectId/integrations")({
	validateSearch: z.object({
		group: z.string().optional(),
	}),
	head: createDynamicRouteHead(({ search }) => {
		const groupLabels: Record<string, string> = {
			database: "Databases",
			kv: "KV Stores",
			ai: "AI Models",
			baas: "BaaS",
			observability: "Observability",
			queue: "Message Queues",
			mcp: "MCP Servers",
		};
		const category = search.group ? groupLabels[search.group] || search.group : "All";
		return {
			title: `Integrations (${category})`,
			description: "Connect databases, AI models, KV stores, and third-party services.",
		};
	}),
	component: IntegrationsPage,
});

const BUILT_IN_CONNECTORS: { name: string; type: string; icon: ReactNode }[] = [
	{ name: "Databases", type: "database", icon: <TbDatabase size={18} /> },
	{ name: "KV", type: "kv", icon: <FaTableList size={16} /> },
	{ name: "AI", type: "ai", icon: <FaRobot size={16} /> },
	{ name: "BaaS", type: "baas", icon: <LuServerCrash size={16} /> },
	{
		name: "Observability",
		type: "observability",
		icon: <TbHeartRateMonitor size={18} />,
	},
	{ name: "Queues", type: "queue", icon: <TbArrowsExchange size={18} /> },
	{ name: "MCP Servers", type: "mcp", icon: <VscMcp size={18} /> },
];

export function IntegrationsPage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Integrations"));
	const { group } = Route.useSearch();
	const navigate = useNavigate();
	const { selectedMenu } = useIntegrationState();
	const { setSelectedMenu } = useIntegrationActions();

	const catalog = useIntegrationCatalog(projectId);
	const { data: allIntegrations = [] } = integrationsQuery.getBasicList.useQuery(projectId);

	const countForGroup = (grp: string) => allIntegrations.filter((i) => i.group === grp).length;

	const builtInGroupSet = useMemo(() => new Set(BUILT_IN_CONNECTORS.map((c) => c.type)), []);

	// Group plugin-owned variants by namespace -> group -> variants
	const namespaceTree = useMemo(() => {
		const map = new Map<string, Map<string, Array<(typeof catalog.items)[number]>>>();
		for (const item of catalog.items ?? []) {
			if (builtInGroupSet.has(item.group)) continue;
			const pluginName =
				typeof item.plugin === "string"
					? item.plugin
					: (item.plugin as { name?: string } | undefined)?.name;
			const pluginNs =
				typeof item.plugin === "object"
					? (item.plugin as { namespace?: string } | undefined)?.namespace
					: undefined;
			const ns =
				item.namespace ??
				pluginNs ??
				pluginName?.split("/")[0] ??
				item.group.split("/")[0] ??
				"plugins";
			if (!map.has(ns)) map.set(ns, new Map());
			const groupsMap = map.get(ns)!;
			if (!groupsMap.has(item.group)) groupsMap.set(item.group, []);
			groupsMap.get(item.group)!.push(item);
		}
		for (const integration of allIntegrations) {
			if (builtInGroupSet.has(integration.group)) continue;
			const ns = integration.group.split("/")[0] || "plugins";
			if (!map.has(ns)) map.set(ns, new Map());
			const groupsMap = map.get(ns)!;
			if (!groupsMap.has(integration.group)) groupsMap.set(integration.group, []);
		}
		return map;
	}, [catalog.items, allIntegrations, builtInGroupSet]);

	// sync selected group from URL (deep-link support)
	useEffect(() => {
		if (group && group !== selectedMenu) setSelectedMenu(group as IntegrationGroup);
	}, [group]);

	function selectGroup(type: string) {
		setSelectedMenu(type as IntegrationGroup);
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
					onPress={() =>
						navigate({
							to: "/$projectId/integrations/new",
							params: { projectId },
							search: { group: selectedMenu },
						})
					}
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
					{BUILT_IN_CONNECTORS.map((c) => {
						const active = selectedMenu === c.type;
						const count = countForGroup(c.type);
						const pluginVariants = catalog.variantItemsOf(c.type).filter((v) => Boolean(v.plugin));
						return (
							<div key={c.type} className="flex flex-col gap-0.5">
								<button
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
											active
												? "bg-surface-secondary text-foreground"
												: "bg-surface-secondary text-muted",
										)}
									>
										{count}
									</span>
								</button>
								{pluginVariants.map((v) => (
									<div
										key={`${c.type}:${v.variant}`}
										role="button"
										tabIndex={0}
										onClick={() => selectGroup(c.type)}
										onKeyDown={(e) => e.key === "Enter" && selectGroup(c.type)}
										className="flex items-center gap-2 rounded-lg py-1.5 pl-8 pr-2.5 text-xs text-muted transition-colors hover:bg-surface-secondary hover:text-foreground cursor-pointer"
									>
										<span className="flex size-4 shrink-0 items-center justify-center">
											{v.icon || (typeof v.plugin === "object" && (v.plugin as any)?.icon) ? (
												<CustomBlockIcon
													icon="custom"
													iconUrl={v.icon || (v.plugin as any)?.icon}
													size={14}
												/>
											) : (
												<TbPlug size={14} />
											)}
										</span>
										<span className="min-w-0 flex-1 truncate">{v.variant}</span>
										<span className="rounded bg-accent/10 px-1.5 py-0.2 text-[10px] font-medium text-accent">
											Plugin
										</span>
									</div>
								))}
							</div>
						);
					})}

					{namespaceTree.size > 0 && (
						<>
							<div className="mt-4 mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-muted">
								PLUGIN INTEGRATIONS
							</div>
							{Array.from(namespaceTree.entries()).map(([namespace, groupsMap]) => (
								<div key={namespace} className="flex flex-col gap-1">
									<div className="flex items-center gap-2 px-3 py-1 text-xs font-semibold text-muted">
										<span className="flex size-4 shrink-0 items-center justify-center text-muted">
											{pluginFolderIcon({ level: "scope", path: namespace })}
										</span>
										<span className="truncate">{namespace}</span>
									</div>
									{Array.from(groupsMap.entries()).map(([grp, variants]) => {
										const active = selectedMenu === grp;
										const count = countForGroup(grp);
										return (
											<div key={grp} className="flex flex-col gap-0.5">
												<button
													type="button"
													onClick={() => selectGroup(grp)}
													className={cn(
														"flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-medium transition-all ml-2",
														active
															? "border-border bg-surface text-foreground shadow-sm"
															: "border-transparent text-muted hover:bg-surface-secondary hover:text-foreground",
													)}
												>
													<span className={cn(active ? "text-accent" : "text-muted")}>
														{pluginFolderIcon({ level: "plugin", path: `${namespace}/${grp}` })}
													</span>
													<span className="truncate">{catalog.labelOf(grp)}</span>
													<span
														className={cn(
															"ml-auto rounded-full px-2 py-0.5 text-xs font-semibold",
															active
																? "bg-surface-secondary text-foreground"
																: "bg-surface-secondary text-muted",
														)}
													>
														{count}
													</span>
												</button>
												{variants.map((v) => (
													<div
														key={`${grp}:${v.variant}`}
														role="button"
														tabIndex={0}
														onClick={() => selectGroup(grp)}
														onKeyDown={(e) => e.key === "Enter" && selectGroup(grp)}
														className="flex items-center gap-2 rounded-lg py-1.5 pl-9 pr-2.5 text-xs text-muted transition-colors hover:bg-surface-secondary hover:text-foreground cursor-pointer"
													>
														<span className="flex size-4 shrink-0 items-center justify-center">
															{v.icon ||
															(typeof v.plugin === "object" && (v.plugin as any)?.icon) ? (
																<CustomBlockIcon
																	icon="custom"
																	iconUrl={v.icon || (v.plugin as any)?.icon}
																	size={14}
																/>
															) : (
																<TbPlug size={14} />
															)}
														</span>
														<span className="min-w-0 flex-1 truncate">{v.variant}</span>
														<span className="rounded bg-accent/10 px-1.5 py-0.2 text-[10px] font-medium text-accent">
															Plugin
														</span>
													</div>
												))}
											</div>
										);
									})}
								</div>
							))}
						</>
					)}
				</nav>

				{/* Column 2 — Center configured list or active creation/editing */}
				<div className="min-w-0 flex-1 overflow-y-auto pr-2">
					<IntegrationsList projectId={projectId} group={selectedMenu} />
				</div>

				{/* Column 3 — Right Panel: Help, Connected Databases & Environment Notice */}
				<RightHelpPanel projectId={projectId} activeGroup={selectedMenu} />
			</div>
		</div>
	);
}

export function IntegrationsList({ projectId, group }: { projectId: string; group: string }) {
	const navigate = useNavigate();
	const catalog = useIntegrationCatalog(projectId);
	const { data, isLoading, isError } = integrationsQuery.getAll.useQuery(projectId, group);
	const openIntegration = (integrationId: string) =>
		navigate({
			to: "/$projectId/integrations/$integrationId",
			params: { projectId, integrationId },
		});

	if (isLoading)
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
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

	const knownVariants = new Set(
		(catalog.items ?? []).filter((item) => item.group === group).map((item) => item.variant),
	);

	return (
		<Table>
			<Table.Content aria-label="Integrations" onRowAction={(key) => openIntegration(String(key))}>
				<Table.Header>
					<Table.Column id="name" isRowHeader>
						Name
					</Table.Column>
					<Table.Column id="type">Type</Table.Column>
					<Table.Column id="actions" aria-label="Actions">
						{""}
					</Table.Column>
				</Table.Header>
				<Table.Body items={data}>
					{(integration) => (
						<Table.Row id={integration.id} className="cursor-pointer">
							<Table.Cell>
								<div className="flex min-w-0 items-center gap-3">
									<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-accent">
										<IntegrationVariantIcon
											variant={integration.variant}
											group={integration.group}
											icon={catalog.iconOf(integration.variant, integration.group)}
										/>
									</div>
									<span className="truncate font-medium text-foreground">{integration.name}</span>
									{!knownVariants.has(integration.variant) && (
										<Chip size="sm" color="warning">
											plugin disabled
										</Chip>
									)}
								</div>
							</Table.Cell>
							<Table.Cell>
								<span className="text-muted">
									{integration.variant} • {group}
								</span>
							</Table.Cell>
							<Table.Cell>
								<div className="flex justify-end">
									<IntegrationTestButtons projectId={projectId} integrationId={integration.id} />
								</div>
							</Table.Cell>
						</Table.Row>
					)}
				</Table.Body>
			</Table.Content>
		</Table>
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
	queue: {
		title: "Message Queues",
		description:
			"Connect Kafka, a NATS JetStream cluster, Amazon SQS or RabbitMQ so a trigger can start a workflow for every message, or every batch of messages.",
		docsUrl: "https://docs.fluxify.rest/integrations/message-queues.html",
		tip: "Set a dead-letter topic under Advanced, or one bad message holds up its partition until it succeeds. For SQS, give the queue a redrive policy in AWS instead; for RabbitMQ, a dead-letter exchange on the queue.",
		tipIcon: <TbArrowsExchange size={16} className="shrink-0 text-muted mt-0.5" />,
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
				<p className="text-xs text-muted leading-relaxed">{info.description}</p>
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

import { Button, CustomSelect, Input, Label, Spinner, TextField } from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TbBulb, TbCloudCog, TbExternalLink, TbPlugConnected, TbSearch } from "react-icons/tb";
import { z } from "zod";
import { PageFooter } from "@/components/common/PageFooter";
import { IntegrationCard } from "@/components/integrations/IntegrationCard";
import { ALL_CATEGORIES, buildCategories } from "@/components/integrations/integrationCategories";
import { INTEGRATION_HELP } from "@/components/integrations/integrationHelp";
import { usePageSize } from "@/lib/pageSize";
import { createDynamicRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { integrationsQuery, useIntegrationCatalog } from "@/query/integrationsQuery";
import { projectsQuery } from "@/query/projectsQuery";

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
			storage: "Object Storage",
		};
		const category = search.group ? groupLabels[search.group] || search.group : "All";
		return {
			title: `Integrations (${category})`,
			description: "Connect databases, AI models, KV stores, and third-party services.",
		};
	}),
	component: IntegrationsPage,
});

export function IntegrationsPage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Integrations"));
	const { group = ALL_CATEGORIES } = Route.useSearch();
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(1);
	const [perPage, setPerPage] = usePageSize("integrations", 20);

	const catalog = useIntegrationCatalog(projectId);
	const {
		data: integrations = [],
		isLoading,
		isError,
	} = integrationsQuery.getBasicList.useQuery(projectId);

	const categories = useMemo(
		() => buildCategories(catalog.catalog, integrations, group),
		[catalog.catalog, integrations, group],
	);
	const active = categories.find((c) => c.group === group);
	const inView = (g: string) => group === ALL_CATEGORIES || g === group;
	const needle = query.trim().toLowerCase();
	const hit = (...text: string[]) => !needle || text.join(" ").toLowerCase().includes(needle);

	const matching = integrations.filter((i) => inView(i.group) && hit(i.name, i.variant));
	const totalPages = Math.max(1, Math.ceil(matching.length / perPage));
	const current = Math.min(page, totalPages);
	const rows = matching.slice((current - 1) * perPage, current * perPage);
	const labelOf = new Map(categories.map((c) => [c.group, c.label]));

	const connect = (group?: string) =>
		navigate({ to: "/$projectId/integrations/new", params: { projectId }, search: { group } });
	const options = [
		{ value: ALL_CATEGORIES, label: `All categories (${integrations.length})` },
		...categories.map((c) => ({
			value: c.group,
			label: `${c.label} (${integrations.filter((i) => i.group === c.group).length})`,
		})),
	];

	return (
		<div className="flex h-full flex-col gap-5 overflow-hidden">
			<div className="flex shrink-0 items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-foreground">Integrations</h1>
					<p className="text-sm text-muted">Connect &amp; Configure 3rd Party Services</p>
				</div>
				<Button variant="primary" onPress={() => connect(active?.group)}>
					<TbPlugConnected size={16} /> Connect App / Service
				</Button>
			</div>

			<div className="flex shrink-0 flex-col gap-2 sm:flex-row">
				<TextField
					value={query}
					onChange={(v) => {
						setQuery(v);
						setPage(1);
					}}
					aria-label="Search integrations"
					className="flex-1"
				>
					<Label className="sr-only">Search integrations</Label>
					<div className="relative">
						<TbSearch
							aria-hidden
							className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
						/>
						<Input placeholder="Search by name or type…" className="w-full pl-9" />
					</div>
				</TextField>
				<CustomSelect
					aria-label="Category"
					className="sm:w-64"
					options={options}
					value={group}
					onChange={(g) => {
						setPage(1);
						navigate({ to: ".", search: { group: g === ALL_CATEGORIES ? undefined : g } });
					}}
				/>
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
				{active && <CategoryHelp group={active.group} />}
				{isLoading ? (
					<div className="flex justify-center py-16">
						<Spinner />
					</div>
				) : isError ? (
					<p className="py-16 text-center text-muted">Couldn't load integrations.</p>
				) : rows.length === 0 ? (
					<EmptyState
						searching={Boolean(needle)}
						label={active?.label}
						onConnect={() => connect(active?.group)}
					/>
				) : (
					<div className="flex flex-col gap-2">
						{rows.map((i) => (
							<IntegrationCard
								key={i.id}
								projectId={projectId}
								integration={i}
								groupLabel={labelOf.get(i.group) ?? i.group}
								icon={catalog.iconOf(i.variant, i.group)}
								variantKnown={catalog.variantsOf(i.group).includes(i.variant)}
							/>
						))}
					</div>
				)}
			</div>
			<PageFooter
				page={current}
				totalPages={totalPages}
				perPage={perPage}
				onPage={setPage}
				onPerPage={(n) => {
					setPerPage(n);
					setPage(1);
				}}
			/>
		</div>
	);
}

/** the docs link and tip of the category being viewed; plugin groups have none */
function CategoryHelp({ group }: { group: string }) {
	const help = INTEGRATION_HELP[group];
	if (!help) return null;
	return (
		<div className="flex items-start gap-3 rounded-xl border border-border bg-surface-secondary p-3 text-xs leading-relaxed text-muted">
			<TbBulb size={16} className="mt-0.5 shrink-0" />
			<span className="flex-1">{help.tip}</span>
			<a
				href={help.docsUrl}
				target="_blank"
				rel="noreferrer"
				className="flex shrink-0 items-center gap-1 font-semibold text-accent hover:underline"
			>
				Docs <TbExternalLink size={12} />
			</a>
		</div>
	);
}

function EmptyState({
	searching,
	label,
	onConnect,
}: {
	searching: boolean;
	label?: string;
	onConnect: () => void;
}) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface p-10 text-center">
			<TbCloudCog size={36} className="text-muted" />
			<div>
				<p className="text-base font-semibold text-foreground">
					{searching ? "No integrations match your search" : "No integrations found"}
				</p>
				<p className="mt-1 text-xs text-muted">
					{searching
						? "Try another name, or pick a different category."
						: `No ${label ?? "services"} connected to this project yet.`}
				</p>
			</div>
			{!searching && (
				<Button variant="primary" onPress={onConnect}>
					<TbPlugConnected size={16} /> Connect App / Service
				</Button>
			)}
		</div>
	);
}

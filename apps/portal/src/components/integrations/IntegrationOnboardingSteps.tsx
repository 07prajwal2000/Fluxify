import { cn, Input, TextField } from "@fluxify/components";
import { getSchema } from "@fluxify/server/src/api/v1/integrations/helpers";
import { TbCheck, TbCloudCog, TbSearch } from "react-icons/tb";
import type { useIntegrationCatalog } from "@/query/integrationsQuery";
import { GROUP_DETAILS } from "./groupDetails";
import { IntegrationVariantIcon } from "./IntegrationVariantIcon";

export type Step = 1 | 2 | 3;

export function parseIntegrationConfig(
	group: string,
	variant: string,
	cfg: unknown,
	isPlugin: boolean,
): { success: true; data: unknown } | { success: false; error: string } {
	const schema = getSchema(group as never, variant as never);
	if (!schema) {
		if (isPlugin) return { success: true, data: cfg };
		return { success: false, error: "Invalid connector selection" };
	}
	const parsed = schema.safeParse(cfg);
	if (!parsed.success) {
		return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid configuration" };
	}
	return { success: true, data: parsed.data };
}

export function StepNav({
	step,
	group,
	variant,
	onGoToStep,
}: {
	step: Step;
	group: string;
	variant: string;
	onGoToStep: (step: Step) => void;
}) {
	return (
		<nav aria-label="Integration setup steps" className="shrink-0 border-b border-border pb-3">
			<ol className="grid grid-cols-3 gap-2">
				{(
					[
						[1, "Category"],
						[2, "Provider"],
						[3, "Configure"],
					] as const
				).map(([number, label]) => {
					const available =
						number === 1 || (number === 2 && Boolean(group)) || (number === 3 && Boolean(variant));
					const complete = number < step;
					const current = step === number;
					return (
						<li key={number}>
							<button
								type="button"
								disabled={!available}
								onClick={() => onGoToStep(number)}
								className={cn(
									"flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs font-medium transition-colors",
									available
										? current
											? "text-foreground"
											: "text-muted hover:bg-surface-secondary hover:text-foreground"
										: "cursor-not-allowed text-muted/50",
								)}
							>
								<span
									className={cn(
										"flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-all",
										complete || current
											? "border-accent bg-accent text-accent-foreground"
											: "border-border bg-surface-secondary text-muted",
									)}
								>
									{complete ? <TbCheck size={12} strokeWidth={3} /> : number}
								</span>
								<span className="hidden truncate sm:inline">{label}</span>
							</button>
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

export function VariantCard({
	cardGroup,
	item,
	currentGroup,
	catalog,
	onSelect,
}: {
	cardGroup: string;
	item: string;
	currentGroup: string;
	catalog: ReturnType<typeof useIntegrationCatalog>;
	onSelect: (group: string, variant: string) => void;
}) {
	const meta = catalog.variantMeta(cardGroup, item);
	const isPlugin = Boolean(meta?.plugin);
	return (
		<button
			key={`${cardGroup}:${item}`}
			type="button"
			onClick={() => onSelect(cardGroup, item)}
			className="group flex items-center gap-3.5 rounded-xl border border-border bg-surface p-3 text-left transition-all duration-150 hover:border-accent hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
		>
			<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
				<IntegrationVariantIcon variant={item} group={cardGroup} icon={meta?.icon} size={20} />
			</span>
			<span className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-semibold text-foreground">{item}</span>
					{isPlugin && (
						<span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
							Plugin
						</span>
					)}
				</div>
				{cardGroup !== currentGroup && (
					<span className="block truncate text-xs text-muted">{catalog.labelOf(cardGroup)}</span>
				)}
			</span>
		</button>
	);
}

export function CategoryStep({
	query,
	onQuery,
	matches,
	groups,
	catalog,
	onSelect,
}: {
	query: string;
	onQuery: (q: string) => void;
	matches: (readonly [string, string])[];
	groups: string[];
	catalog: ReturnType<typeof useIntegrationCatalog>;
	onSelect: (group: string, variant: string) => void;
}) {
	const search = query.trim().toLowerCase();
	return (
		<section aria-labelledby="integration-category-heading">
			<div>
				<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
					Step 1 of 3
				</p>
				<h2
					id="integration-category-heading"
					className="mt-1 text-lg font-semibold tracking-tight text-foreground"
				>
					What would you like to connect?
				</h2>
				<p className="mt-0.5 text-xs text-muted">
					Choose a category, or search for a service by name.
				</p>
			</div>
			<TextField value={query} onChange={onQuery} aria-label="Search services" className="mt-3.5">
				<div className="relative w-full">
					<TbSearch
						size={16}
						className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
					/>
					<Input autoFocus placeholder="Search services…" className="w-full pl-9" />
				</div>
			</TextField>
			{search && (
				<div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
					{matches.length === 0 ? (
						<p className="text-sm text-muted">No services match "{query.trim()}".</p>
					) : (
						matches.map(([g, v]) => (
							<VariantCard
								key={`${g}:${v}`}
								cardGroup={g}
								item={v}
								currentGroup=""
								catalog={catalog}
								onSelect={onSelect}
							/>
						))
					)}
				</div>
			)}
			<div className={cn("mt-3.5 grid gap-2.5 sm:grid-cols-2", search && "hidden")}>
				{groups.map((item) => {
					const detail = GROUP_DETAILS[item] ?? {
						description: "Connect a service",
						icon: <TbCloudCog size={20} />,
					};
					const isAvailable = catalog.variantsOf(item).length > 0;
					return (
						<button
							key={item}
							type="button"
							disabled={!isAvailable}
							onClick={() => onSelect(item, "")}
							className={cn(
								"group flex items-center gap-3.5 rounded-xl border p-3 text-left transition-all duration-150",
								isAvailable
									? "border-border bg-surface hover:border-accent hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
									: "cursor-not-allowed border-border/50 bg-surface/50 opacity-45",
							)}
						>
							<span
								className={cn(
									"flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors",
									isAvailable
										? "bg-accent/10 text-accent group-hover:bg-accent group-hover:text-accent-foreground"
										: "bg-surface-secondary text-muted/50",
								)}
							>
								{detail.icon}
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-semibold text-foreground">
									{catalog.labelOf(item)}
								</span>
								<span className="mt-0.5 block truncate text-xs text-muted">
									{isAvailable ? detail.description : "Coming soon"}
								</span>
							</span>
						</button>
					);
				})}
			</div>
		</section>
	);
}

export function ProviderStep({
	group,
	groupName,
	variants,
	catalog,
	onSelect,
}: {
	group: string;
	groupName: string;
	variants: string[];
	catalog: ReturnType<typeof useIntegrationCatalog>;
	onSelect: (group: string, variant: string) => void;
}) {
	return (
		<section aria-labelledby="integration-provider-heading">
			<div>
				<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
					Step 2 of 3
				</p>
				<h2
					id="integration-provider-heading"
					className="mt-1 text-lg font-semibold tracking-tight text-foreground"
				>
					Choose a {groupName.toLowerCase()} provider
				</h2>
				<p className="mt-0.5 text-xs text-muted">Select the service you want to configure.</p>
			</div>
			<div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
				{variants.map((item) => (
					<VariantCard
						key={`${group}:${item}`}
						cardGroup={group}
						item={item}
						currentGroup={group}
						catalog={catalog}
						onSelect={onSelect}
					/>
				))}
			</div>
		</section>
	);
}

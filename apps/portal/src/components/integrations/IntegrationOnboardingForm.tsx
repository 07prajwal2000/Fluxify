import { Button, cn, Input, integrationIcons, TextField, toast } from "@fluxify/components";
import {
	getDefaultVariantValue,
	getIntegrationsGroups,
	getIntegrationsVariants,
	getSchema,
	humanReadableConnectorNames,
} from "@fluxify/server/src/api/v1/integrations/helpers";
import { useBlocker } from "@tanstack/react-router";
import { type ReactNode, useRef, useState } from "react";
import { FaRobot, FaTableList } from "react-icons/fa6";
import {
	TbArrowLeft,
	TbArrowsExchange,
	TbBolt,
	TbCheck,
	TbCloudCog,
	TbDatabase,
	TbHeartRateMonitor,
	TbSearch,
} from "react-icons/tb";
import { EnterpriseGate, useEnterprise } from "@/components/common/Enterprise";
import { showErrorNotification } from "@/lib/errorNotifier";
import { integrationsQuery } from "@/query/integrationsQuery";
import { ConnectorFields, setPath } from "./ConnectorFields";
import { showTestResult } from "./showTestResult";

type Step = 1 | 2 | 3;

/** Queue connectors only feed triggers, which need an enterprise license. */
function gateQueue(group: string, card: ReactNode, key: string) {
	return group === "queue" ? (
		<EnterpriseGate key={key} compact>
			{card}
		</EnterpriseGate>
	) : (
		card
	);
}

const GROUP_DETAILS: Record<string, { description: string; icon: ReactNode }> = {
	database: { description: "Connect a production database", icon: <TbDatabase size={20} /> },
	kv: { description: "Connect a cache or key-value store", icon: <FaTableList size={18} /> },
	ai: { description: "Connect an AI provider or compatible endpoint", icon: <FaRobot size={18} /> },
	baas: { description: "Connect a managed backend service", icon: <TbCloudCog size={20} /> },
	observability: {
		description: "Send logs and telemetry to your stack",
		icon: <TbHeartRateMonitor size={20} />,
	},
	queue: {
		description: "Start workflows from a message queue",
		icon: <TbArrowsExchange size={20} />,
	},
};

const variantsOf = (group: string): string[] =>
	getIntegrationsGroups().includes(group as never) ? getIntegrationsVariants(group as never) : [];

/**
 * `group` and `variant` come from the URL, so refresh and back/forward keep
 * the user's place. Unknown values are ignored rather than rejected. Remount
 * with a `key` per variant to reset the typed-in fields.
 */
export function IntegrationOnboardingForm({
	projectId,
	group: rawGroup = "",
	variant: rawVariant = "",
	onSelect,
	onSaved,
}: {
	projectId: string;
	group?: string;
	variant?: string;
	onSelect: (group: string, variant: string) => void;
	onSaved: (created: { id: string; group: string }) => void;
}) {
	const create = integrationsQuery.create.mutation(projectId);
	const test = integrationsQuery.testConnection.mutation(projectId);
	const variants = variantsOf(rawGroup);
	const group = variants.length > 0 ? rawGroup : "";
	const variant = variants.includes(rawVariant) ? rawVariant : "";
	const step: Step = variant ? 3 : group ? 2 : 1;
	// A deep link can skip the gated card on step 2, so gate the form too.
	const enterprise = useEnterprise();
	const locked = group === "queue" && !enterprise;

	const [defaults] = useState(
		() => (variant && (getDefaultVariantValue(variant as never) as Record<string, unknown>)) || {},
	);
	const [name, setName] = useState("");
	const [config, setConfig] = useState(defaults);
	const [query, setQuery] = useState("");
	const saved = useRef(false);

	const dirty = step === 3 && (name !== "" || JSON.stringify(config) !== JSON.stringify(defaults));
	// Any navigation from a dirty step 3 drops the typed fields: leaving the
	// page, or stepping back (which changes the search params and remounts).
	useBlocker({
		shouldBlockFn: () =>
			dirty &&
			!saved.current &&
			!window.confirm("Discard this integration? Your changes will be lost."),
		enableBeforeUnload: () => dirty && !saved.current,
	});

	const groups = getIntegrationsGroups();
	const search = query.trim().toLowerCase();
	const matches = search
		? groups.flatMap((g) =>
				variantsOf(g)
					.filter((v) => `${v} ${g}`.toLowerCase().includes(search))
					.map((v) => [g, v] as const),
			)
		: [];

	function setField(path: string, value: unknown) {
		setConfig((current) => setPath(current, path, value));
	}

	function goToStep(nextStep: Step) {
		if (nextStep === 1) onSelect("", "");
		if (nextStep === 2 && group) onSelect(group, "");
	}

	function variantCard(cardGroup: string, item: string) {
		return gateQueue(
			cardGroup,
			<button
				key={`${cardGroup}:${item}`}
				type="button"
				onClick={() => onSelect(cardGroup, item)}
				className="group flex items-center gap-3.5 rounded-xl border border-border bg-surface p-3 text-left transition-all duration-150 hover:border-accent hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
			>
				<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
					{integrationIcons[item] ?? GROUP_DETAILS[cardGroup]?.icon}
				</span>
				<span className="min-w-0">
					<span className="block truncate text-sm font-semibold text-foreground">{item}</span>
					{cardGroup !== group && (
						<span className="block truncate text-xs text-muted">
							{humanReadableConnectorNames[cardGroup as keyof typeof humanReadableConnectorNames]}
						</span>
					)}
				</span>
			</button>,
			`${cardGroup}:${item}`,
		);
	}

	function testIntegration() {
		const schema = getSchema(group as never, variant as never);
		if (!schema) {
			toast.danger("Invalid connector selection");
			return;
		}
		const parsed = schema.safeParse(config);
		if (!parsed.success) {
			toast.danger(parsed.error.issues[0]?.message ?? "Invalid configuration");
			return;
		}

		test.mutate(
			{ group, variant, config: parsed.data },
			{
				onSuccess: showTestResult,
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	function saveIntegration() {
		const schema = getSchema(group as never, variant as never);
		if (!schema) {
			toast.danger("Invalid connector selection");
			return;
		}
		const parsed = schema.safeParse(config);
		if (!parsed.success) {
			toast.danger(parsed.error.issues[0]?.message ?? "Invalid configuration");
			return;
		}

		create.mutate({ name, group, variant, config: parsed.data } as never, {
			onSuccess: ({ id }) => {
				toast.success("Integration connected");
				saved.current = true;
				onSaved({ id, group });
			},
			onError: (error) => showErrorNotification(error as Error),
		});
	}

	const formProps = { projectId, name, onName: setName, config, setField };
	const groupName = group
		? humanReadableConnectorNames[group as keyof typeof humanReadableConnectorNames]
		: "";

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-5">
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
							number === 1 ||
							(number === 2 && Boolean(group)) ||
							(number === 3 && Boolean(variant));
						const complete = number < step;
						const current = step === number;
						return (
							<li key={number}>
								<button
									type="button"
									disabled={!available}
									onClick={() => goToStep(number)}
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

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
				{step === 1 && (
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
						<TextField
							value={query}
							onChange={setQuery}
							aria-label="Search services"
							className="mt-3.5"
						>
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
									matches.map(([g, v]) => variantCard(g, v))
								)}
							</div>
						)}
						<div className={cn("mt-3.5 grid gap-2.5 sm:grid-cols-2", search && "hidden")}>
							{groups.map((item) => {
								const detail = GROUP_DETAILS[item] ?? {
									description: "Connect a service",
									icon: <TbCloudCog size={20} />,
								};
								const isAvailable = getIntegrationsVariants(item as never).length > 0;
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
												{
													humanReadableConnectorNames[
														item as keyof typeof humanReadableConnectorNames
													]
												}
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
				)}

				{step === 2 && (
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
							{variants.map((item) => variantCard(group, item))}
						</div>
					</section>
				)}

				{step === 3 && (
					<section aria-labelledby="integration-configure-heading" className="flex flex-1 flex-col">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
									Step 3 of 3
								</p>
								<h2
									id="integration-configure-heading"
									className="mt-1 text-lg font-semibold tracking-tight text-foreground"
								>
									Configure {variant}
								</h2>
							</div>
							<div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-xs text-foreground">
								<span className="flex size-4 items-center justify-center text-accent">
									{integrationIcons[variant] ?? GROUP_DETAILS[group]?.icon}
								</span>
								<span className="font-medium text-foreground">{variant}</span>
							</div>
						</div>
						<p className="mt-0.5 text-xs text-muted">
							Add the connection details and credentials for this service.
						</p>

						<div className={cn("mt-4", locked && "hidden")}>
							<ConnectorFields {...formProps} group={group} variant={variant} />
						</div>
						{locked && (
							<EnterpriseGate className="mt-4">
								<div className="h-40 rounded-xl border border-border bg-surface" />
							</EnterpriseGate>
						)}
					</section>
				)}
			</div>

			<div className="flex shrink-0 items-center justify-between border-t border-border pt-3.5">
				{step > 1 ? (
					<Button variant="ghost" size="sm" onPress={() => goToStep((step - 1) as Step)}>
						<TbArrowLeft size={16} /> Back
					</Button>
				) : (
					<span />
				)}
				{step === 3 && (
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							isPending={test.isPending}
							isDisabled={locked}
							onPress={testIntegration}
							className="whitespace-nowrap"
						>
							<TbBolt size={14} className="text-accent" />
							<span>Test connection</span>
						</Button>
						<Button
							variant="primary"
							size="sm"
							isPending={create.isPending}
							isDisabled={locked}
							onPress={saveIntegration}
						>
							Connect {variant}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

import { Button, Checkbox, integrationIcons, toast } from "@fluxify/components";
import { getDefaultVariantValue } from "@fluxify/server/src/api/v1/integrations/helpers";
import { useBlocker } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { TbArrowLeft, TbBolt } from "react-icons/tb";
import { parseApiError, showErrorNotification } from "@/lib/errorNotifier";
import { integrationsQuery, useIntegrationCatalog } from "@/query/integrationsQuery";
import { useIsProjectAdmin } from "@/store/auth";
import { setPath } from "./ConnectorFields";
import { EnvironmentIntegrationFields, isConfigEmpty } from "./EnvironmentIntegrationFields";
import {
	CategoryStep,
	GROUP_DETAILS,
	ProviderStep,
	parseIntegrationConfig,
	type Step,
	StepNav,
} from "./IntegrationOnboardingSteps";
import { showTestResult } from "./showTestResult";

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
	const catalog = useIntegrationCatalog(projectId);
	const { loaded, groups, variantsOf, labelOf } = catalog;
	const variants = variantsOf(rawGroup);
	const group = variants.length > 0 ? rawGroup : "";
	const variant = variants.includes(rawVariant) ? rawVariant : "";
	const step: Step = variant ? 3 : group ? 2 : 1;
	const isAdmin = useIsProjectAdmin(projectId);

	const [defaults] = useState(
		// the URL's variant, not the checked one: the list loads after this first render
		() =>
			(rawVariant && (getDefaultVariantValue(rawVariant as never) as Record<string, unknown>)) ||
			{},
	);
	const [name, setName] = useState("");
	const [testedTools, setTestedTools] = useState<{ name: string; description: string }[] | null>(
		null,
	);
	const [config, setConfig] = useState(defaults);
	const [devConfig, setDevConfig] = useState<Record<string, unknown> | null>(null);
	const [syncDev, setSyncDev] = useState(false);
	const [query, setQuery] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [testError, setTestError] = useState<string | null>(null);
	const saved = useRef(false);

	const dirty =
		step === 3 &&
		(name !== "" ||
			JSON.stringify(config) !== JSON.stringify(defaults) ||
			devConfig !== null ||
			syncDev !== false);
	// Any navigation from a dirty step 3 drops the typed fields: leaving the
	// page, or stepping back (which changes the search params and remounts).
	useBlocker({
		shouldBlockFn: () =>
			dirty &&
			!saved.current &&
			!window.confirm("Discard this integration? Your changes will be lost."),
		enableBeforeUnload: () => dirty && !saved.current,
	});

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

	function testIntegration() {
		const toTest = syncDev ? config : devConfig;
		if (!syncDev && isConfigEmpty(toTest)) {
			toast.danger(
				"Dev workers will fail until you set a development value or turn on Same as production.",
			);
			return;
		}
		const isPlugin = Boolean(catalog.variantMeta(group, variant)?.plugin);
		const parsed = parseIntegrationConfig(group, variant, toTest, isPlugin);
		if (!parsed.success) {
			toast.danger(parsed.error);
			return;
		}

		setTestError(null);
		test.mutate(
			{ group, variant, config: parsed.data as Record<string, unknown> },
			{
				onSuccess: (res) => {
					showTestResult(res);
					if (res?.tools) setTestedTools(res.tools);
				},
				onError: (err: unknown) => {
					const message =
						err instanceof Error
							? err.message
							: typeof (err as { message?: unknown })?.message === "string"
								? String((err as { message?: unknown }).message)
								: "Connection test failed";
					setTestError(message);
					toast.danger(message);
				},
			},
		);
	}

	function saveIntegration() {
		const isPlugin = Boolean(catalog.variantMeta(group, variant)?.plugin);
		const parsed = parseIntegrationConfig(group, variant, config, isPlugin);
		if (!name.trim()) {
			toast.danger("Integration name is required");
			return;
		}
		if (!parsed.success) {
			toast.danger(parsed.error);
			return;
		}

		let parsedDev: unknown = null;
		if (!syncDev && devConfig && !isConfigEmpty(devConfig)) {
			const devResult = parseIntegrationConfig(group, variant, devConfig, isPlugin);
			if (!devResult.success) {
				toast.danger(devResult.error);
				return;
			}
			parsedDev = devResult.data;
		}

		setFormError(null);
		create.mutate(
			{
				name: name.trim(),
				group,
				variant,
				config: parsed.data as Record<string, unknown>,
				devConfig: syncDev ? null : (parsedDev as Record<string, unknown> | null),
				syncDev,
			} as never,
			{
				onSuccess: ({ id }) => {
					toast.success("Integration connected");
					saved.current = true;
					onSaved({ id, group });
				},
				onError: (err: unknown) => {
					const apiErr = parseApiError(err);
					const pathless = apiErr.fieldErrors?.find((e) => !e.field || e.field === "");
					if (pathless) {
						setFormError(pathless.message);
					} else {
						setFormError(apiErr.message || "Failed to create integration");
					}
					showErrorNotification(err as Error);
				},
			},
		);
	}

	const groupName = group ? labelOf(group) : "";
	// until the list arrives every group reads as unknown, which would flash step 1
	if (!loaded) return null;

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-5">
			<StepNav step={step} group={group} variant={variant} onGoToStep={goToStep} />

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
				{step === 1 && (
					<CategoryStep
						query={query}
						onQuery={setQuery}
						matches={matches}
						groups={groups}
						catalog={catalog}
						onSelect={onSelect}
					/>
				)}

				{step === 2 && (
					<ProviderStep
						group={group}
						groupName={groupName}
						variants={variants}
						catalog={catalog}
						onSelect={onSelect}
					/>
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
							<div className="flex items-center gap-3">
								<Checkbox
									isSelected={syncDev}
									onChange={setSyncDev}
									isDisabled={group === "mcp" && !isAdmin}
									label="Same as prod"
								/>
								<div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-xs text-foreground">
									<span className="flex size-4 items-center justify-center text-accent">
										{integrationIcons[variant] ?? GROUP_DETAILS[group]?.icon}
									</span>
									<span className="font-medium text-foreground">{variant}</span>
								</div>
							</div>
						</div>
						<p className="mt-0.5 text-xs text-muted">
							Add the connection details and credentials for this service.
						</p>

						<div className="mt-4">
							{group === "mcp" && !isAdmin && (
								<p className="mb-3 text-xs text-warning">
									Only project admins can connect MCP servers.
								</p>
							)}
							<EnvironmentIntegrationFields
								projectId={projectId}
								group={group}
								variant={variant}
								name={name}
								onName={setName}
								config={config}
								setField={setField}
								devConfig={devConfig}
								setDevField={(path, value) => setDevConfig((c) => setPath(c ?? {}, path, value))}
								syncDev={syncDev}
								onSyncDevChange={setSyncDev}
								readOnly={group === "mcp" && !isAdmin}
								tools={testedTools ?? undefined}
								formError={formError}
								tabs
							/>
							{testError && (
								<div
									role="alert"
									className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
								>
									{testError}
								</div>
							)}
						</div>
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
							isDisabled={group === "mcp" && !isAdmin}
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

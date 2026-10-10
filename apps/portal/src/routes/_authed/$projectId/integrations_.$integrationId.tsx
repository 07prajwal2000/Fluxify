import { Button, DeleteButton, integrationIcons, Spinner, toast } from "@fluxify/components";
import {
	getSchema,
	humanReadableConnectorNames,
} from "@fluxify/server/src/api/v1/integrations/helpers";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TbArrowLeft, TbBolt, TbCloudCog } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { setPath } from "@/components/integrations/ConnectorFields";
import {
	EnvironmentIntegrationFields,
	isConfigEmpty,
} from "@/components/integrations/EnvironmentIntegrationFields";
import { showTestResult } from "@/components/integrations/showTestResult";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { integrationsQuery } from "@/query/integrationsQuery";
import { projectsQuery } from "@/query/projectsQuery";
import { useCanEditProject } from "@/store/auth";

export const Route = createFileRoute("/_authed/$projectId/integrations_/$integrationId")({
	head: createRouteHead("Integration", "View and edit an integration's connection details."),
	component: IntegrationDetailsPage,
});

function IntegrationDetailsPage() {
	const { projectId, integrationId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	const loaded = integrationsQuery.getById.useQuery(projectId, integrationId);
	usePageTitle(formatProjectTitle(project?.name, loaded.data?.name ?? "Integration"));
	const navigate = useNavigate();
	const canEdit = useCanEditProject(projectId);
	const update = integrationsQuery.update.mutation(projectId);
	const test = integrationsQuery.testConnection.mutation(projectId);
	const testProd = integrationsQuery.testProductionConnection.mutation(projectId);
	const remove = integrationsQuery.remove.mutation(projectId);

	const [name, setName] = useState("");
	// null until the saved config is in: a form mounted on an empty config would
	// seed its tabs and modes from nothing (URL vs credentials, NATS login)
	const [config, setConfig] = useState<Record<string, unknown> | null>(null);
	const [devConfig, setDevConfig] = useState<Record<string, unknown> | null>(null);
	const [syncDev, setSyncDev] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);

	useEffect(() => {
		if (!loaded.data) return;
		setName(loaded.data.name);
		setConfig(loaded.data.config as Record<string, unknown>);
		setDevConfig((loaded.data.devConfig as Record<string, unknown>) ?? null);
		setSyncDev(Boolean(loaded.data.syncDev));
	}, [loaded.data]);

	const group = loaded.data?.group ?? "";
	const variant = loaded.data?.variant ?? "";
	const toList = () =>
		navigate({ to: "/$projectId/integrations", params: { projectId }, search: { group } });

	if (loaded.isLoading || (loaded.data && !config))
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	if (!loaded.data || !config)
		return <p className="py-16 text-center text-muted">Couldn't load this integration.</p>;

	function parseConfig(cfg: Record<string, unknown> | null) {
		const parsed = getSchema(group as never, variant as never)?.safeParse(cfg);
		if (!parsed) toast.danger("Invalid connector selection");
		else if (!parsed.success)
			toast.danger(parsed.error.issues[0]?.message ?? "Invalid configuration");
		else return parsed.data;
	}

	function save() {
		if (!name.trim()) return toast.danger("Name is required");
		const parsed = parseConfig(config);
		if (!parsed) return;
		let parsedDev: unknown = null;
		if (!syncDev && devConfig && !isConfigEmpty(devConfig)) {
			parsedDev = parseConfig(devConfig);
			if (!parsedDev) return;
		}
		update.mutate(
			{
				id: integrationId,
				data: {
					name,
					config: parsed,
					devConfig: syncDev ? null : parsedDev,
					syncDev,
				} as never,
			},
			{
				onSuccess: () => toast.success("Integration updated"),
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	function testConnection() {
		const toTest = syncDev ? config : devConfig;
		if (!syncDev && isConfigEmpty(toTest)) {
			toast.danger(
				"Dev workers will fail until you set a development value or turn on Same as production.",
			);
			return;
		}
		const parsed = parseConfig(toTest);
		if (!parsed) return;
		test.mutate(
			{ group, variant, config: parsed },
			{ onSuccess: showTestResult, onError: (e) => showErrorNotification(e as Error) },
		);
	}

	function testProduction() {
		testProd.mutate(integrationId, {
			onSuccess: showTestResult,
			onError: (e) => showErrorNotification(e as Error),
		});
	}

	return (
		<div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-5">
			<div className="flex shrink-0 items-center gap-3">
				<Button isIconOnly variant="ghost" aria-label="Back to integrations" onPress={toList}>
					<TbArrowLeft size={18} />
				</Button>
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-accent">
					{integrationIcons[variant] ?? <TbCloudCog size={20} />}
				</div>
				<div className="min-w-0">
					<h1 className="truncate text-xl font-semibold tracking-tight">{loaded.data.name}</h1>
					<p className="text-xs text-muted">
						{variant} •{" "}
						{humanReadableConnectorNames[group as keyof typeof humanReadableConnectorNames] ??
							group}
					</p>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border pt-4 pr-1">
				<EnvironmentIntegrationFields
					projectId={projectId}
					name={name}
					onName={setName}
					config={config}
					setField={(path, value) => setConfig((c) => c && setPath(c, path, value))}
					devConfig={devConfig}
					setDevField={(path, value) => setDevConfig((c) => setPath(c ?? {}, path, value))}
					syncDev={syncDev}
					onSyncDevChange={setSyncDev}
					group={group}
					variant={variant}
				/>
			</div>

			<div className="flex shrink-0 items-center justify-between border-t border-border pt-3.5">
				<DeleteButton size="sm" onPress={() => setConfirmDelete(true)}>
					Delete
				</DeleteButton>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						isPending={test.isPending}
						onPress={testConnection}
						className="whitespace-nowrap"
					>
						<TbBolt size={14} className="text-accent" />
						<span>Test connection</span>
					</Button>
					{canEdit && (
						<Button
							variant="outline"
							size="sm"
							isPending={testProd.isPending}
							onPress={testProduction}
							className="whitespace-nowrap"
						>
							<TbBolt size={14} className="text-accent" />
							<span>Test production credentials</span>
						</Button>
					)}
					<Button variant="primary" size="sm" isPending={update.isPending} onPress={save}>
						Save changes
					</Button>
				</div>
			</div>

			<ConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title="Delete integration?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() =>
					remove.mutate(integrationId, {
						onSuccess: () => {
							toast.success("Integration deleted");
							toList();
						},
						onError: (e) => showErrorNotification(e as Error),
					})
				}
			>
				You are about to delete the integration. This action is irreversible.
			</ConfirmDialog>
		</div>
	);
}

import {
	Breadcrumbs,
	Button,
	CloseButton,
	IntegrationPickerModal,
	IntegrationSelector,
	Label,
	NumberField,
	Spinner,
	toast,
} from "@fluxify/components";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { useCallback, useEffect, useState } from "react";
import {
	TbAlertTriangle,
	TbArrowLeft,
	TbBook,
	TbExternalLink,
	TbPlugConnected,
	TbPlus,
	TbTrash,
} from "react-icons/tb";
import { VscMcp } from "react-icons/vsc";
import { withBasePath } from "@/constants/routes";
import { showErrorNotification } from "@/lib/errorNotifier";
import { integrationsQuery } from "@/query/integrationsQuery";
import { knowledgeSourcesQuery } from "@/query/knowledgeSourcesQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { integrationService } from "@/services/integrations";
import { useCanEditProject, useIsProjectAdmin } from "@/store/auth";
import { EphemeralRunSettings } from "./EphemeralRunSettings";
import { KnowledgeBasePanel } from "./knowledgeBase/KnowledgeBasePanel";
import { ProductionAskSettings } from "./ProductionAskSettings";

export function AiConnectionsSettings({ projectId }: { projectId: string }) {
	const [view, setView] = useState<"config" | "kb">("config");
	const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
	const [isAdding, setIsAdding] = useState(false);

	const { data, isLoading } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);
	const { data: sources = [] } = knowledgeSourcesQuery.getAll.useQuery(projectId);

	const settings = (data ?? {}) as Record<string, string>;
	const selectedSource = sources.find((s) => s.id === selectedSourceId);

	const canEdit = useCanEditProject(projectId);

	function handleBreadcrumb(key: string) {
		if (key === "config") {
			setView("config");
			setIsAdding(false);
		} else if (key === "kb") {
			setIsAdding(false);
			setSelectedSourceId(null);
		}
	}

	return (
		<div className="flex flex-col flex-1 min-h-0 w-full h-full gap-4">
			{/* Breadcrumb Navigation Header */}
			<div className="flex shrink-0 items-center justify-between border-b border-border pb-3">
				<div className="flex items-center gap-3">
					{view === "kb" && (
						<Button
							size="sm"
							variant="ghost"
							onPress={() => {
								setView("config");
								setIsAdding(false);
							}}
						>
							<TbArrowLeft size={14} className="mr-1" /> AI config
						</Button>
					)}
					<Breadcrumbs onAction={(key) => handleBreadcrumb(String(key))}>
						<Breadcrumbs.Item id="config">AI config</Breadcrumbs.Item>
						{view === "kb" && <Breadcrumbs.Item id="kb">Knowledge base</Breadcrumbs.Item>}
						{view === "kb" && isAdding && <Breadcrumbs.Item id="add">New source</Breadcrumbs.Item>}
						{view === "kb" && !isAdding && selectedSource && (
							<Breadcrumbs.Item id={`source:${selectedSource.id}`}>
								{selectedSource.name}
							</Breadcrumbs.Item>
						)}
					</Breadcrumbs>
				</div>

				{view === "kb" && canEdit && !isAdding && (
					<Button
						variant="primary"
						size="sm"
						onPress={() => {
							setIsAdding(true);
							setSelectedSourceId(null);
						}}
					>
						<TbPlus size={14} className="mr-1.5" /> Add source
					</Button>
				)}
			</div>

			{view === "config" ? (
				<div className="flex flex-col gap-4 max-w-4xl overflow-y-auto">
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-xl font-semibold tracking-tight">AI configuration</h1>
							<p className="text-sm text-muted">Manage your AI connection and agent limits.</p>
						</div>
						<Button
							variant="outline"
							size="sm"
							onPress={() => {
								setView("kb");
								setIsAdding(false);
								setSelectedSourceId(null);
							}}
						>
							<TbBook size={16} className="mr-1.5" /> Manage KB
						</Button>
					</div>

					{isLoading ? (
						<div className="flex justify-center py-8">
							<Spinner />
						</div>
					) : (
						<AiSelector
							projectId={projectId}
							label="Agent LLM Connection"
							description="Select the AI integration used by the built-in agents and workflow AI nodes."
							selectedId={settings["settings.ai.agentConnectionId"] || ""}
							onSelect={(value) =>
								upsert.mutate(
									{ key: "settings.ai.agentConnectionId", value } as RequestBodySchema,
									{
										onSuccess: () => toast.success("AI connection saved"),
										onError: (e) => showErrorNotification(e as Error),
									},
								)
							}
						/>
					)}
					{!isLoading && (
						<McpSelector
							projectId={projectId}
							selectedIds={
								settings["settings.ai.agentMcpIntegrations"]
									? settings["settings.ai.agentMcpIntegrations"]
											.split(",")
											.map((s) => s.trim())
											.filter(Boolean)
									: []
							}
							onChange={(next) =>
								upsert.mutate(
									{
										key: "settings.ai.agentMcpIntegrations",
										value: next.join(","),
									} as RequestBodySchema,
									{
										onSuccess: () => toast.success("Allowed MCP servers saved"),
										onError: (e) => showErrorNotification(e as Error),
									},
								)
							}
							isDisabled={!canEdit}
						/>
					)}
					{!isLoading && <AgentLimits projectId={projectId} settings={settings} />}
					{!isLoading && <EphemeralRunSettings projectId={projectId} settings={settings} />}
					{!isLoading && <ProductionAskSettings projectId={projectId} settings={settings} />}
				</div>
			) : (
				<KnowledgeBasePanel
					projectId={projectId}
					selectedSourceId={selectedSourceId}
					isAdding={isAdding}
					onSelectSource={setSelectedSourceId}
					onSetIsAdding={setIsAdding}
				/>
			)}
		</div>
	);
}

const LIMITS = [
	{ key: "settings.ai.maxSteps", label: "Max steps per run", def: 40, min: 1, max: 200, step: 1 },
	{
		key: "settings.ai.maxContextTokens",
		label: "Max context length (tokens)",
		def: 128000,
		min: 8000,
		step: 1000,
		max: 2000000,
	},
	{
		key: "settings.ai.tokenBudget",
		label: "Token budget per run",
		def: 1000000,
		min: 10000,
		step: 1000,
		max: 100000000,
	},
] as const;

function AgentLimits({
	projectId,
	settings,
}: {
	projectId: string;
	settings: Record<string, string>;
}) {
	const isAdmin = useIsProjectAdmin(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);
	const saved = (key: string, def: number) => Number(settings[key]) || def;
	const [values, setValues] = useState<Record<string, number>>({});

	// biome-ignore lint/correctness/useExhaustiveDependencies: refill when the saved map changes
	useEffect(() => {
		setValues(Object.fromEntries(LIMITS.map((l) => [l.key, saved(l.key, l.def)])));
	}, [settings]);

	function save() {
		for (const l of LIMITS) {
			const value = values[l.key];
			if (!value || value === saved(l.key, l.def)) continue;
			upsert.mutate({ key: l.key, value: String(value) } as RequestBodySchema, {
				onSuccess: () => toast.success(`${l.label} saved`),
				onError: (e) => showErrorNotification(e as Error),
			});
		}
	}

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
			<div>
				<h3 className="font-medium text-foreground">Agent limits</h3>
				<p className="text-sm text-muted">
					When a run reaches the step cap or the token budget, it asks to continue.
					{isAdmin ? "" : " Only a project admin can change these."}
				</p>
			</div>
			{LIMITS.map((l) => (
				<NumberField
					key={l.key}
					value={values[l.key] ?? l.def}
					minValue={l.min}
					maxValue={l.max}
					step={l.step}
					isDisabled={!isAdmin}
					onChange={(next) => setValues((v) => ({ ...v, [l.key]: next }))}
					className="w-64"
				>
					<Label>{l.label}</Label>
					<NumberField.Group>
						<NumberField.DecrementButton />
						<NumberField.Input />
						<NumberField.IncrementButton />
					</NumberField.Group>
				</NumberField>
			))}
			{isAdmin && (
				<Button
					variant="primary"
					size="sm"
					className="self-start"
					isPending={upsert.isPending}
					onPress={save}
				>
					Save
				</Button>
			)}
		</div>
	);
}

function AiSelector({
	projectId,
	label,
	description,
	selectedId,
	onSelect,
}: {
	projectId: string;
	label: string;
	description: string;
	selectedId: string;
	onSelect: (value: string) => void;
}) {
	const loadIntegrations = useCallback(
		async () => (await integrationService.getAll(projectId, "ai")) ?? [],
		[projectId],
	);

	return (
		<IntegrationSelector
			label={label}
			description={description}
			group="ai"
			selectedId={selectedId}
			loadIntegrations={loadIntegrations}
			onSelect={onSelect}
			onTestConnection={(id) =>
				integrationService.testExistingConnection(projectId, id).then(() => {})
			}
			openInNewTabUrl={withBasePath(
				`/${projectId}/integrations${selectedId ? `/${encodeURIComponent(selectedId)}` : "?group=ai"}`,
			)}
			createIntegrationUrl={withBasePath(`/${projectId}/integrations/new?group=ai`)}
		/>
	);
}

function McpSelector({
	projectId,
	selectedIds,
	onChange,
	isDisabled,
}: {
	projectId: string;
	selectedIds: string[];
	onChange: (values: string[]) => void;
	isDisabled?: boolean;
}) {
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [testingId, setTestingId] = useState<string | null>(null);

	const {
		data: mcpIntegrations = [],
		isLoading,
		isFetching,
		refetch,
	} = integrationsQuery.getAll.useQuery(projectId, "mcp");

	const handleAdd = (id: string) => {
		if (!selectedIds.includes(id)) {
			onChange([...selectedIds, id]);
		}
	};

	const handleRemove = (id: string) => {
		onChange(selectedIds.filter((x) => x !== id));
	};

	const handleTest = async (id: string) => {
		setTestingId(id);
		try {
			await integrationService.testExistingConnection(projectId, id);
			toast.success("Connection successful");
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Connection test failed";
			toast.danger(msg);
		} finally {
			setTestingId(null);
		}
	};

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="font-medium text-foreground">Allowed MCP Servers</h3>
					<p className="text-sm text-muted">
						Select the MCP servers the agent may use when answering questions and performing tasks.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					isDisabled={isDisabled || isLoading}
					onPress={() => setIsModalOpen(true)}
				>
					<TbPlus size={14} className="mr-1.5" /> Add server
				</Button>
			</div>

			{isLoading ? (
				<div className="flex items-center justify-center py-6 text-muted">
					<Spinner size="sm" className="mr-2" />
					<span className="text-sm">Loading servers…</span>
				</div>
			) : selectedIds.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 text-center">
					<div className="mb-2 flex size-10 items-center justify-center rounded-full bg-surface-secondary text-muted">
						<VscMcp size={20} />
					</div>
					<p className="text-sm font-medium text-foreground">No MCP servers allowed</p>
					<p className="mt-0.5 max-w-sm text-xs text-muted">
						Click &ldquo;Add server&rdquo; to connect an MCP integration for the agent to use.
					</p>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{selectedIds.map((id) => {
						const server = mcpIntegrations.find((item) => item.id === id);
						const isDeleted = !server;

						if (isDeleted) {
							return (
								<div
									key={id}
									className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 p-3"
								>
									<div className="flex min-w-0 items-center gap-3">
										<div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-danger/20 bg-danger/10 text-danger">
											<TbAlertTriangle size={18} />
										</div>
										<div className="flex min-w-0 flex-col">
											<div className="flex items-center gap-2">
												<span className="text-sm font-medium text-foreground">Unknown Server</span>
												<span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-danger">
													Deleted
												</span>
											</div>
											<span className="truncate font-mono text-xs text-muted">{id}</span>
											<span className="text-xs text-danger/80">
												This integration was deleted from the project.
											</span>
										</div>
									</div>
									<Button
										size="sm"
										variant="danger"
										isDisabled={isDisabled}
										onPress={() => handleRemove(id)}
										aria-label={`Remove deleted reference ${id}`}
									>
										<TbTrash size={14} className="mr-1" /> Remove reference
									</Button>
								</div>
							);
						}

						const serverUrl =
							server.config && typeof server.config === "object" && "url" in server.config
								? String(server.config.url)
								: undefined;

						return (
							<div
								key={id}
								className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-secondary/40 p-3 transition-colors hover:bg-surface-secondary/70"
							>
								<div className="flex min-w-0 items-center gap-3">
									<div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-foreground">
										<VscMcp size={18} />
									</div>
									<div className="flex min-w-0 flex-col">
										<div className="flex items-center gap-2">
											<span className="truncate text-sm font-medium text-foreground">
												{server.name}
											</span>
											<span className="shrink-0 rounded-full border border-border bg-surface-secondary px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">
												{server.variant}
											</span>
										</div>
										{serverUrl && (
											<span className="max-w-md truncate font-mono text-xs text-muted">
												{serverUrl}
											</span>
										)}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1.5">
									<Button
										aria-label="Test connection"
										size="sm"
										variant="ghost"
										isDisabled={testingId === id}
										onPress={() => handleTest(id)}
									>
										{testingId === id ? <Spinner size="sm" /> : <TbPlugConnected size={16} />}
									</Button>
									<Button
										aria-label="Open integration settings"
										size="sm"
										variant="ghost"
										onPress={() => {
											window.open(
												withBasePath(`/${projectId}/integrations/${id}`),
												"_blank",
												"noopener,noreferrer",
											);
										}}
									>
										<TbExternalLink size={16} />
									</Button>
									<CloseButton
										aria-label={`Remove ${server.name}`}
										isDisabled={isDisabled}
										onPress={() => handleRemove(id)}
									/>
								</div>
							</div>
						);
					})}
				</div>
			)}

			<IntegrationPickerModal
				isOpen={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				integrations={mcpIntegrations}
				selectedId={selectedIds}
				onSelect={handleAdd}
				createIntegrationUrl={withBasePath(`/${projectId}/integrations/new?group=mcp`)}
				onRefresh={() => void refetch()}
				isRefreshing={isFetching}
			/>
		</div>
	);
}

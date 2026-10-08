import {
	Button,
	IntegrationSelector,
	Label,
	NumberField,
	Spinner,
	toast,
} from "@fluxify/components";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { useCallback, useEffect, useState } from "react";
import { withBasePath } from "@/constants/routes";
import { showErrorNotification } from "@/lib/errorNotifier";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { integrationService } from "@/services/integrations";
import { useIsProjectAdmin } from "@/store/auth";

export function AiConnectionsSettings({ projectId }: { projectId: string }) {
	const { data, isLoading } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);

	const settings = (data ?? {}) as Record<string, string>;

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">AI configuration</h1>
				<p className="text-sm text-muted">Manage your AI connection and agent limits.</p>
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
						upsert.mutate({ key: "settings.ai.agentConnectionId", value } as RequestBodySchema, {
							onSuccess: () => toast.success("AI connection saved"),
							onError: (e) => showErrorNotification(e as Error),
						})
					}
				/>
			)}
			{!isLoading && <AgentLimits projectId={projectId} settings={settings} />}
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

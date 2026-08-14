import { useEffect, useMemo, useState } from "react";
import { Button, DeleteIconButton, Spinner, toast } from "@fluxify/components";
import { TbBolt } from "react-icons/tb";
import {
	getIntegrationsGroups,
	getIntegrationsVariants,
	getDefaultVariantValue,
	getSchema,
	humanReadableConnectorNames,
} from "@fluxify/server/src/api/v1/integrations/helpers";
import { integrationsQuery } from "@/query/integrationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { CredentialsUrlForm } from "./connectors/CredentialsUrlForm";
import { AiForm } from "./connectors/AiForm";
import { ObservabilityForm } from "./connectors/ObservabilityForm";

type IntegrationData = { name: string; group: string; variant: string; config: Record<string, unknown> };

const CRED_PLACEHOLDERS: Record<string, { ph: Record<string, string>; ssl?: boolean; db?: boolean }> = {
	PostgreSQL: { ph: { name: "My Postgres Database", host: "postgres.company.com", port: "5432", username: "postgres", password: "secret", database: "ecommerce", url: "postgres://user:pass@host:port/dbname?ssl=disable" }, ssl: true, db: true },
	MySQL: { ph: { name: "My MySQL Database", host: "mysql.company.com", port: "3306", username: "root", password: "secret", database: "ecommerce", url: "mysql://user:pass@host:port/dbname?ssl=disable" }, db: true },
	MongoDB: { ph: { name: "My MongoDB Database", host: "localhost", port: "27017", username: "mongo_user", password: "secret", database: "mydatabase", url: "mongodb://user:pass@host:port/dbname" }, db: true },
	Redis: { ph: { name: "My Redis Cache", host: "redis.company.com", port: "6379", username: "default", password: "secret", url: "redis://user:pass@host:port", database: "" }, db: false },
	Memcached: { ph: { name: "My Memcached Instance", host: "memcached.company.com", port: "11211", username: "default", password: "secret", url: "memcached://user:pass@host:port", database: "" }, db: false },
};

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
	const keys = path.split(".");
	const next = structuredClone(obj);
	let cur: Record<string, unknown> = next;
	for (let i = 0; i < keys.length - 1; i++) {
		const k = keys[i];
		if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
		cur = cur[k] as Record<string, unknown>;
	}
	cur[keys[keys.length - 1]] = value;
	return next;
}

export function IntegrationForm({
	projectId,
	id,
	initialData,
	lockGroupVariant,
	showDelete,
	deletePending,
	hideActions,
	onSaved,
	onDelete,
}: {
	projectId: string;
	id?: string;
	initialData?: IntegrationData;
	lockGroupVariant?: boolean;
	showDelete?: boolean;
	deletePending?: boolean;
	hideActions?: boolean;
	onSaved?: () => void;
	onDelete?: () => void;
}) {
	const loaded = integrationsQuery.getById.useQuery(projectId, id ?? "");
	const create = integrationsQuery.create.mutation(projectId);
	const update = integrationsQuery.update.mutation(projectId);
	const test = integrationsQuery.testConnection.mutation(projectId);

	const [name, setName] = useState(initialData?.name ?? "");
	const [group, setGroup] = useState(initialData?.group ?? "");
	const [variant, setVariant] = useState(initialData?.variant ?? "");
	const [config, setConfig] = useState<Record<string, unknown>>(initialData?.config ?? {});
	const [confirmDelete, setConfirmDelete] = useState(false);
	const hydrated = useMemo(() => ({ id }), [id]);

	// hydrate from loaded (edit mode)
	useEffect(() => {
		if (loaded.data) {
			setName(loaded.data.name);
			setGroup(loaded.data.group);
			setVariant(loaded.data.variant);
			setConfig(loaded.data.config as Record<string, unknown>);
		}
	}, [loaded.data]);

	function onGroup(g: string) {
		setGroup(g);
		setVariant("");
		setConfig({});
	}
	function onVariant(v: string) {
		setVariant(v);
		setConfig((getDefaultVariantValue(v as never) as Record<string, unknown>) ?? {});
	}
	function setField(path: string, value: unknown) {
		setConfig((c) => setPath(c, path, value));
	}

	function onSave() {
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
		if (id) {
			update.mutate(
				{ id, data: { name, config: parsed.data } as never },
				{ onSuccess: () => { toast.success("Integration updated"); onSaved?.(); }, onError: (e) => showErrorNotification(e as Error) },
			);
		} else {
			create.mutate({ name, group, variant, config: parsed.data } as never, {
				onSuccess: () => { toast.success("Integration connected"); onSaved?.(); },
				onError: (e) => showErrorNotification(e as Error),
			});
		}
	}

	function onTest() {
		test.mutate(
			{ group, variant, config },
			{
				onSuccess: (res) =>
					res?.success ? toast.success("Connection successful") : toast.danger(res?.error ?? "Connection failed"),
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	if (id && loaded.isLoading) {
		return <div className="flex justify-center py-8"><Spinner /></div>;
	}

	const formProps = { projectId, name, onName: setName, config, setField };

	return (
		<div className="flex flex-col gap-4">
			{/* Show Connector & Variant selectors ONLY when creating a new integration (not configured yet) */}
			{!lockGroupVariant && !id && (
				<>
					{/* Choose a Connector (group) */}
					<div className="flex flex-col gap-1">
						<label className="text-sm font-medium text-foreground">Choose a Connector</label>
						<span className="text-xs text-muted">Choose from a range of connectors to get started</span>
						<select
							value={group}
							onChange={(e) => onGroup(e.target.value)}
							className="rounded-md border border-border bg-background-secondary px-3 py-2 text-sm text-foreground outline-none"
						>
							<option value="">Select…</option>
							{getIntegrationsGroups().map((g) => (
								<option key={g} value={g}>
									{humanReadableConnectorNames[g as keyof typeof humanReadableConnectorNames]}
								</option>
							))}
						</select>
					</div>

					{/* Select Variant */}
					{group && (
						<div className="flex flex-col gap-1">
							<label className="text-sm font-medium text-foreground">Select Variant</label>
							<span className="text-xs text-muted">Select the service you want to configure &amp; connect to</span>
							<select
								value={variant}
								onChange={(e) => onVariant(e.target.value)}
								className="rounded-md border border-border bg-background-secondary px-3 py-2 text-sm text-foreground outline-none"
							>
								<option value="">Select…</option>
								{getIntegrationsVariants(group as never).map((v) => (
									<option key={v} value={v}>{v}</option>
								))}
							</select>
						</div>
					)}
				</>
			)}

			{/* Connector-specific form */}
			{group === "database" && CRED_PLACEHOLDERS[variant] && (
				<CredentialsUrlForm {...formProps} placeholders={CRED_PLACEHOLDERS[variant].ph as never} hasDatabase={CRED_PLACEHOLDERS[variant].db} hasSSL={CRED_PLACEHOLDERS[variant].ssl} />
			)}
			{group === "kv" && CRED_PLACEHOLDERS[variant] && (
				<CredentialsUrlForm {...formProps} placeholders={CRED_PLACEHOLDERS[variant].ph as never} hasDatabase={false} />
			)}
			{group === "ai" && variant && (
				<AiForm {...formProps} showBaseUrl={variant === "OpenAI Compatible"} />
			)}
			{group === "observability" && variant === "Loki" && (
				<ObservabilityForm {...formProps} namePlaceholder="Loki | Production" baseUrlPlaceholder="http://loki:3100" baseUrlDescription="Base url of the loki instance" />
			)}
			{group === "observability" && variant === "Open Telemetry" && (
				<ObservabilityForm {...formProps} namePlaceholder="OpenTelemetry | Production" baseUrlPlaceholder="https://http-intake.logs.datadoghq.com/api/v2/logs" baseUrlDescription="Base url of the OTLP endpoint, without the /v1/... path (OpenObserve, Datadog, Grafana, BetterStack)" />
			)}

			{/* Actions */}
			{!hideActions && group && variant && (
				<div className="flex items-center justify-between pt-2 border-t border-border">
					<div>
						{showDelete && id && (
							<DeleteIconButton
								onPress={() => setConfirmDelete(true)}
								aria-label="Delete integration"
								iconSize={15}
							/>
						)}
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							isPending={test.isPending}
							onPress={onTest}
							className="whitespace-nowrap"
						>
							<TbBolt size={14} className="text-accent" />
							<span>Test connection</span>
						</Button>
						<Button variant="primary" isPending={create.isPending || update.isPending} onPress={onSave}>
							{id ? "Save changes" : "Connect"}
						</Button>
					</div>
				</div>
			)}

			<ConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title="Delete integration?"
				danger
				confirmText="Delete"
				pending={deletePending}
				onConfirm={() => {
					setConfirmDelete(false);
					onDelete?.();
				}}
			>
				You are about to delete the integration. This action is irreversible.
			</ConfirmDialog>
			{/* keep hydrated ref referenced */}
			<span className="hidden">{hydrated.id}</span>
		</div>
	);
}

import { Checkbox, cn, Input } from "@fluxify/components";
import { AppConfigSelector } from "../AppConfigSelector";
import type { ConnectorFormProps } from "./types";

// the runtime's default when an integration leaves it out
const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

type Placeholders = {
	name: string;
	host: string;
	port: string;
	username: string;
	password: string;
	database?: string;
	url: string;
};

// Shared form for credentials-or-URL connectors (Postgres/MySQL/Mongo/Redis/Memcached).
export function CredentialsUrlForm({
	projectId,
	name,
	onName,
	config,
	setField,
	placeholders,
	hasDatabase = true,
	hasSSL = false,
	hasQueryTimeout = false,
	defaultMaxConnections,
	databaseLabel = "Database Name",
}: ConnectorFormProps & {
	placeholders: Placeholders;
	hasDatabase?: boolean;
	hasSSL?: boolean;
	/** databases: queries running longer than this are stopped */
	hasQueryTimeout?: boolean;
	/** databases: shows the pool size field, with this as its default */
	defaultMaxConnections?: number;
	databaseLabel?: string;
}) {
	// read from the config, never copied into state: an edit page fills the config
	// after this mounts, and a copy would stay on "credentials"
	const tab = config.source === "url" ? "url" : "credentials";
	const isUrl = tab === "url";

	return (
		<div className="flex flex-col gap-3.5">
			<div className="flex flex-col gap-1">
				<label
					htmlFor="credentials-integration-name"
					className="text-xs font-medium text-foreground"
				>
					Integration Name <span className="text-danger">*</span>
				</label>
				<Input
					id="credentials-integration-name"
					value={name}
					onChange={(e) => onName(e.currentTarget.value)}
					placeholder={placeholders.name}
				/>
			</div>

			<div className="flex rounded-lg border border-border bg-background-secondary p-1">
				{(["credentials", "url"] as const).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setField("source", t)}
						className={cn(
							"flex-1 rounded-md py-1 text-xs font-medium transition-all duration-150",
							tab === t
								? "bg-surface text-foreground shadow-sm"
								: "text-muted hover:text-foreground",
						)}
					>
						{t === "url" ? "Via URL" : "Credentials"}
					</button>
				))}
			</div>

			{!isUrl ? (
				<div className="grid grid-cols-2 gap-3">
					<AppConfigSelector
						projectId={projectId}
						value={(config.host as string) ?? ""}
						onChange={(v) => setField("host", v)}
						label="Host"
						placeholder={placeholders.host}
					/>
					<AppConfigSelector
						projectId={projectId}
						value={config.port?.toString() ?? ""}
						onChange={(v) => setField("port", v)}
						label="Port"
						placeholder={placeholders.port}
					/>
					<AppConfigSelector
						projectId={projectId}
						value={config.username?.toString() ?? ""}
						onChange={(v) => setField("username", v)}
						label="Username"
						placeholder={placeholders.username}
					/>
					<AppConfigSelector
						projectId={projectId}
						value={config.password?.toString() ?? ""}
						onChange={(v) => setField("password", v)}
						label="Password"
						placeholder={placeholders.password}
					/>
					{hasDatabase && (
						<AppConfigSelector
							projectId={projectId}
							value={config.database?.toString() ?? ""}
							onChange={(v) => setField("database", v)}
							label={databaseLabel}
							placeholder={placeholders.database ?? ""}
						/>
					)}
					{hasSSL && (
						<div className={cn("flex items-end pb-1.5", hasDatabase ? "" : "col-span-2")}>
							<Checkbox isSelected={Boolean(config.useSSL)} onChange={(v) => setField("useSSL", v)}>
								Use SSL?
							</Checkbox>
						</div>
					)}
				</div>
			) : (
				<AppConfigSelector
					projectId={projectId}
					value={(config.url as string) ?? ""}
					onChange={(v) => setField("url", v)}
					label="URL"
					description="Connection String"
					placeholder={placeholders.url}
				/>
			)}

			{hasQueryTimeout && (
				<div className="flex flex-col gap-1">
					<label
						htmlFor="integration-query-timeout"
						className="text-xs font-medium text-foreground"
					>
						Query timeout (seconds)
					</label>
					<Input
						id="integration-query-timeout"
						type="number"
						min={1}
						value={String(Number(config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS) / 1000)}
						onChange={(e) => {
							const seconds = Math.max(1, Math.round(Number(e.currentTarget.value) || 0));
							setField("queryTimeoutMs", seconds * 1000);
						}}
					/>
					<p className="text-xs text-muted">
						A query running longer than this is stopped with an error. Default: 30 seconds.
					</p>
				</div>
			)}

			{defaultMaxConnections && (
				<div className="flex flex-col gap-1">
					<label
						htmlFor="integration-max-connections"
						className="text-xs font-medium text-foreground"
					>
						Max connections
					</label>
					<Input
						id="integration-max-connections"
						type="number"
						min={1}
						max={1000}
						value={String(config.maxConnections ?? defaultMaxConnections)}
						onChange={(e) => {
							const n = Math.round(Number(e.currentTarget.value) || 0);
							setField("maxConnections", Math.min(1000, Math.max(1, n)));
						}}
					/>
					<p className="text-xs text-muted">
						Per worker. Your database can see up to workers × this number. Default:{" "}
						{defaultMaxConnections}.
					</p>
				</div>
			)}
		</div>
	);
}

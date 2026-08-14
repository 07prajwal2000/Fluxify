import { useState } from "react";
import { Checkbox, Input, cn } from "@fluxify/components";
import { AppConfigSelector } from "../AppConfigSelector";
import type { ConnectorFormProps } from "./types";

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
}: ConnectorFormProps & {
	placeholders: Placeholders;
	hasDatabase?: boolean;
	hasSSL?: boolean;
}) {
	const [tab, setTab] = useState<"credentials" | "url">(
		config.source === "url" ? "url" : "credentials",
	);
	const isUrl = tab === "url";

	return (
		<div className="flex flex-col gap-3.5">
			<div className="flex flex-col gap-1">
				<label className="text-xs font-medium text-foreground">
					Integration Name <span className="text-danger">*</span>
				</label>
				<Input
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
						onClick={() => {
							setField("source", t === "url" ? "url" : "credentials");
							setTab(t);
						}}
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
							label="Database Name"
							placeholder={placeholders.database ?? ""}
						/>
					)}
					{hasSSL && (
						<div className={cn("flex items-end pb-1.5", hasDatabase ? "" : "col-span-2")}>
							<Checkbox
								isSelected={Boolean(config.useSSL)}
								onChange={(v) => setField("useSSL", v)}
							>
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
		</div>
	);
}

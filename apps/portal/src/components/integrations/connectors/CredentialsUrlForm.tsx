import { useState } from "react";
import { Button, Checkbox, Input, Label, cn } from "@fluxify/components";
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
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<Label>Name *</Label>
				<span className="text-xs text-muted">Unique Name for the integration</span>
				<Input
					value={name}
					onChange={(e) => onName(e.currentTarget.value)}
					placeholder={placeholders.name}
				/>
			</div>

			<div className="flex gap-1.5 rounded-md border border-border p-1">
				{(["credentials", "url"] as const).map((t) => (
					<Button
						key={t}
						type="button"
						fullWidth
						variant={tab === t ? "primary" : "ghost"}
						onPress={() => {
							setField("source", t === "url" ? "url" : "credentials");
							setTab(t);
						}}
					>
						{t === "url" ? "Via URL" : "Credentials"}
					</Button>
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
						<div className={cn("flex items-end", hasDatabase ? "" : "col-span-2")}>
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

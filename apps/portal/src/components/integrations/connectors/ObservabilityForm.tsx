import { Input, cn } from "@fluxify/components";
import { AppConfigSelector } from "../AppConfigSelector";
import type { ConnectorFormProps } from "./types";

// Loki / OpenTelemetry Logs: baseUrl + Base64-encoded OR username/password credentials.
export function ObservabilityForm({
	projectId,
	name,
	onName,
	config,
	setField,
	namePlaceholder,
	baseUrlPlaceholder,
	baseUrlDescription,
}: ConnectorFormProps & {
	namePlaceholder: string;
	baseUrlPlaceholder: string;
	baseUrlDescription: string;
}) {
	const isCredentials = typeof config.credentials === "object";
	const creds = (config.credentials ?? {}) as { username?: string; password?: string };

	return (
		<div className="flex flex-col gap-3.5">
			<div className="flex flex-col gap-1">
				<label className="text-xs font-medium text-foreground">
					Integration Name <span className="text-danger">*</span>
				</label>
				<Input value={name} onChange={(e) => onName(e.currentTarget.value)} placeholder={namePlaceholder} />
			</div>

			<AppConfigSelector
				projectId={projectId}
				value={(config.baseUrl as string) ?? ""}
				onChange={(v) => setField("baseUrl", v)}
				label="Base URL"
				description={baseUrlDescription}
				placeholder={baseUrlPlaceholder}
			/>

			<div className="flex rounded-lg border border-border bg-background-secondary p-1">
				<button
					type="button"
					onClick={() => setField("credentials", "")}
					className={cn(
						"flex-1 rounded-md py-1 text-xs font-medium transition-all duration-150",
						!isCredentials
							? "bg-surface text-foreground shadow-sm"
							: "text-muted hover:text-foreground",
					)}
				>
					Base64 Encoded
				</button>
				<button
					type="button"
					onClick={() => setField("credentials", { username: "", password: "" })}
					className={cn(
						"flex-1 rounded-md py-1 text-xs font-medium transition-all duration-150",
						isCredentials
							? "bg-surface text-foreground shadow-sm"
							: "text-muted hover:text-foreground",
					)}
				>
					Credentials
				</button>
			</div>

			{!isCredentials ? (
				<AppConfigSelector
					projectId={projectId}
					value={(config.credentials as string) ?? ""}
					onChange={(v) => setField("credentials", v)}
					label="Base64 Value"
					description="Base64 Encoded Credential username:password (Basic Auth)"
					placeholder="base64…"
				/>
			) : (
				<div className="grid grid-cols-2 gap-3">
					<AppConfigSelector
						projectId={projectId}
						value={creds.username ?? ""}
						onChange={(v) => setField("credentials.username", v)}
						label="Email"
						placeholder="email@company.co"
					/>
					<AppConfigSelector
						projectId={projectId}
						value={creds.password ?? ""}
						onChange={(v) => setField("credentials.password", v)}
						label="Password"
						placeholder="password"
					/>
				</div>
			)}
		</div>
	);
}

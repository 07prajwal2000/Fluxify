import { Button, Input, Label } from "@fluxify/components";
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
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<Label>Name *</Label>
				<span className="text-xs text-muted">Unique Name for the integration</span>
				<Input value={name} onChange={(e) => onName(e.currentTarget.value)} placeholder={namePlaceholder} />
			</div>

			<AppConfigSelector
				projectId={projectId}
				value={(config.baseUrl as string) ?? ""}
				onChange={(v) => setField("baseUrl", v)}
				label="Base Url"
				description={baseUrlDescription}
				placeholder={baseUrlPlaceholder}
			/>

			<div className="flex gap-1.5 rounded-md border border-border p-1">
				<Button
					type="button"
					fullWidth
					variant={isCredentials ? "ghost" : "primary"}
					onPress={() => setField("credentials", "")}
				>
					Base64 Encoded
				</Button>
				<Button
					type="button"
					fullWidth
					variant={isCredentials ? "primary" : "ghost"}
					onPress={() => setField("credentials", { username: "", password: "" })}
				>
					Credentials
				</Button>
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
						description="Email / username"
						placeholder="email@company.co"
					/>
					<AppConfigSelector
						projectId={projectId}
						value={creds.password ?? ""}
						onChange={(v) => setField("credentials.password", v)}
						label="Password"
						description="Password"
						placeholder="password"
					/>
				</div>
			)}
		</div>
	);
}

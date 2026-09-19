import { cn, Input, Label } from "@fluxify/components";
import { AppConfigSelector } from "../AppConfigSelector";
import { HeadersEditor } from "../HeadersEditor";
import type { ConnectorFormProps } from "./types";

function Segmented<T extends string>({
	options,
	value,
	onChange,
}: {
	options: Record<T, string>;
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<div className="flex rounded-lg border border-border bg-background-secondary p-1">
			{(Object.keys(options) as T[]).map((key) => (
				<button
					key={key}
					type="button"
					onClick={() => onChange(key)}
					className={cn(
						"flex-1 rounded-md py-1 text-xs font-medium transition-all duration-150",
						value === key
							? "bg-surface text-foreground shadow-sm"
							: "text-muted hover:text-foreground",
					)}
				>
					{options[key]}
				</button>
			))}
		</div>
	);
}

// Loki / OpenTelemetry: baseUrl + Base64-encoded OR username/password credentials,
// extra headers, and for OpenTelemetry an HTTP or gRPC transport.
export function ObservabilityForm({
	projectId,
	name,
	onName,
	config,
	setField,
	namePlaceholder,
	baseUrlPlaceholder,
	baseUrlDescription,
	supportsGrpc = false,
}: ConnectorFormProps & {
	namePlaceholder: string;
	baseUrlPlaceholder: string;
	baseUrlDescription: string;
	supportsGrpc?: boolean;
}) {
	const isCredentials = typeof config.credentials === "object";
	const creds = (config.credentials ?? {}) as {
		username?: string;
		password?: string;
	};
	const grpc = supportsGrpc && config.protocol === "grpc";
	const tlsMode = (config.tlsMode as "none" | "tls" | "mtls" | undefined) ?? "tls";
	const field = (key: string) => (config[key] as string) ?? "";

	return (
		<div className="flex flex-col gap-3.5">
			<div className="flex flex-col gap-1">
				<label
					htmlFor="observability-integration-name"
					className="text-xs font-medium text-foreground"
				>
					Integration Name <span className="text-danger">*</span>
				</label>
				<Input
					id="observability-integration-name"
					value={name}
					onChange={(e) => onName(e.currentTarget.value)}
					placeholder={namePlaceholder}
				/>
			</div>

			{supportsGrpc && (
				<div className="flex flex-col gap-1">
					<Label>Protocol</Label>
					<Segmented
						options={{ http: "HTTP", grpc: "gRPC" }}
						value={grpc ? "grpc" : "http"}
						onChange={(v) => setField("protocol", v)}
					/>
				</div>
			)}

			<AppConfigSelector
				projectId={projectId}
				value={field("baseUrl")}
				onChange={(v) => setField("baseUrl", v)}
				label="Base URL"
				description={
					grpc
						? "gRPC endpoint of the OTLP collector, host and port only (usually 4317)"
						: baseUrlDescription
				}
				placeholder={grpc ? "http://otel-collector:4317" : baseUrlPlaceholder}
			/>

			{grpc && (
				<div className="flex flex-col gap-1">
					<Label>Connection security</Label>
					<Segmented
						options={{ none: "Plaintext", tls: "TLS", mtls: "mTLS" }}
						value={tlsMode}
						onChange={(v) => setField("tlsMode", v)}
					/>
				</div>
			)}

			{grpc && tlsMode === "mtls" && (
				<>
					<AppConfigSelector
						projectId={projectId}
						value={field("clientCert")}
						onChange={(v) => setField("clientCert", v)}
						label="Client certificate"
						description="PEM, or pick an app config value"
						placeholder="-----BEGIN CERTIFICATE-----"
					/>
					<AppConfigSelector
						projectId={projectId}
						value={field("clientKey")}
						onChange={(v) => setField("clientKey", v)}
						label="Client key"
						description="PEM, or pick an app config value"
						placeholder="-----BEGIN PRIVATE KEY-----"
					/>
					<AppConfigSelector
						projectId={projectId}
						value={field("caCert")}
						onChange={(v) => setField("caCert", v)}
						label="CA certificate (optional)"
						description="Only needed when the collector's certificate is signed by a private CA"
						placeholder="-----BEGIN CERTIFICATE-----"
					/>
				</>
			)}

			<Segmented
				options={{ base64: "Base64 Encoded", credentials: "Credentials" }}
				value={isCredentials ? "credentials" : "base64"}
				onChange={(v) =>
					setField("credentials", v === "credentials" ? { username: "", password: "" } : "")
				}
			/>

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

			<HeadersEditor
				projectId={projectId}
				value={config.headers as Record<string, string> | undefined}
				onChange={(headers) => setField("headers", headers)}
				description="Sent with every request, e.g. an API key or tenant id the collector expects"
			/>
		</div>
	);
}

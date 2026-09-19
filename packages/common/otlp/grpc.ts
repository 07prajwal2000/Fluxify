import type { ChannelCredentials, Metadata } from "@grpc/grpc-js";

export type OtlpProtocol = "http" | "grpc";
export type GrpcTlsMode = "none" | "tls" | "mtls";

/** How to reach an OTLP destination. Everything but `protocol` is gRPC-only. */
export type OtlpTransport = {
	protocol?: OtlpProtocol;
	/** `none` is plaintext — a local collector on 4317 speaks nothing else */
	tlsMode?: GrpcTlsMode;
	/** PEM, already `cfg:`-resolved. Only for a private CA. */
	caCert?: string;
	/** PEM client certificate and key, for mTLS */
	clientCert?: string;
	clientKey?: string;
};

/**
 * A PEM pasted into a single-line `<input>` loses its line breaks, and a PEM
 * without them does not parse. Rebuilds every block in the value — a chain has
 * several — as a 64-column body between its armor lines.
 */
export function normalizePem(value: string): string {
	return value.replace(
		// trailing whitespace is consumed so re-normalizing a chain adds no blank lines
		/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----\s*/g,
		(_, label: string, body: string) => {
			const lines = body.replace(/\s+/g, "").match(/.{1,64}/g) ?? [];
			return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
		},
	);
}

const pem = (value?: string) => (value ? Buffer.from(normalizePem(value)) : undefined);

/**
 * Exporter options for the gRPC transport.
 *
 * gRPC has no `/v1/{signal}` path — the url is the channel target as given.
 * Credentials are chosen explicitly rather than from the url scheme, so the
 * user's TLS choice wins over whatever scheme they typed.
 *
 * `@grpc/grpc-js` is required lazily, as the OTEL exporters themselves do:
 * `logging/otlp/logs.ts` sits behind the root barrel, and every importer of
 * `@fluxify/common` should not pay for loading gRPC.
 */
export function grpcExporterOptions(
	url: string,
	headers: Record<string, string> | undefined,
	transport: OtlpTransport,
): { url: string; metadata: Metadata; credentials: ChannelCredentials } {
	const grpc = require("@grpc/grpc-js") as typeof import("@grpc/grpc-js");
	const metadata = new grpc.Metadata();
	for (const [key, value] of Object.entries(headers ?? {})) {
		// gRPC rejects keys HTTP tolerates; a bad user header must not take the
		// whole exporter down with it
		try {
			metadata.set(key, value);
		} catch {}
	}
	const credentials =
		transport.tlsMode === "none"
			? grpc.credentials.createInsecure()
			: transport.tlsMode === "mtls"
				? grpc.credentials.createSsl(
						pem(transport.caCert),
						pem(transport.clientKey),
						pem(transport.clientCert),
					)
				: grpc.credentials.createSsl(pem(transport.caCert));
	return { url, metadata, credentials };
}

/**
 * Probes a gRPC OTLP receiver by exporting an empty batch of `signal` — the gRPC
 * twin of the HTTP probe's empty POST. An empty batch still makes the RPC, so a
 * dead port, a TLS mismatch and a rejected credential all come back as failures.
 *
 * Exporters are imported here, not at the top: this runs only from "Test
 * connection", and the root barrel should not load them.
 */
export async function probeGrpc(
	signal: "logs" | "traces" | "metrics",
	url: string,
	headers: Record<string, string> | undefined,
	transport: OtlpTransport,
): Promise<boolean> {
	type Probe = {
		export(batch: unknown, done: (result: { code: number }) => void): void;
		shutdown(): Promise<void>;
	};
	let exporter: Probe | undefined;
	try {
		const options = { ...grpcExporterOptions(url, headers, transport), timeoutMillis: 5000 };
		let batch: unknown = [];
		if (signal === "traces") {
			const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-grpc");
			exporter = new OTLPTraceExporter(options) as unknown as Probe;
		} else if (signal === "metrics") {
			const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-grpc");
			const { Resource } = await import("@opentelemetry/resources");
			exporter = new OTLPMetricExporter(options) as unknown as Probe;
			batch = { resource: Resource.empty(), scopeMetrics: [] };
		} else {
			const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-grpc");
			exporter = new OTLPLogExporter(options) as unknown as Probe;
		}
		const probe = exporter;
		const code = await new Promise<number>((resolve) =>
			probe.export(batch, (result) => resolve(result.code)),
		);
		// ExportResultCode.SUCCESS
		return code === 0;
	} catch {
		// a malformed PEM throws while building the credentials
		return false;
	} finally {
		exporter?.shutdown().catch(() => {});
	}
}

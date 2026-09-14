import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { logs } from "@opentelemetry/api-logs";
import { Resource } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { grpcExporterOptions, type OtlpTransport } from "../../otlp/grpc";

export interface OtlpLoggerOptions {
	/** full `/v1/logs` url over http; the bare channel target over gRPC */
	url: string;
	headers: Record<string, string>;
	transport?: OtlpTransport;
	serviceName: string;
}

export function createOtlpLoggerProvider({
	url,
	headers,
	serviceName,
	transport = {},
}: OtlpLoggerOptions): LoggerProvider {
	// 1. Setup OpenTelemetry OTLP exporter
	// the gRPC exporter is required only when used: this module sits behind the
	// root barrel, which every `@fluxify/common` importer loads
	const logExporter =
		transport.protocol === "grpc"
			? new (
					require("@opentelemetry/exporter-logs-otlp-grpc") as typeof import("@opentelemetry/exporter-logs-otlp-grpc")
				).OTLPLogExporter(grpcExporterOptions(url, headers, transport))
			: new OTLPLogExporter({
					url,
					headers,
				});

	// 2. Setup the LoggerProvider using SDK 1.x factory methods
	const loggerProvider = new LoggerProvider({
		resource: Resource.default().merge(
			new Resource({
				"service.name": serviceName,
				"stream-name": serviceName,
			})
		),
	});

	// SimpleLogRecordProcessor ensures logs ship immediately without batch delays during testing
	loggerProvider.addLogRecordProcessor(
		new BatchLogRecordProcessor(logExporter, {
			exportTimeoutMillis: 20 * 1000,
			maxQueueSize: 100,
		})
	);

	return loggerProvider;
}

/**
 * Initializes the OpenTelemetry LoggerProvider, registers it globally,
 * and sets up the OTLP log exporter.
 */
export function initializeOtlpLogger(options: OtlpLoggerOptions): void {
	const loggerProvider = createOtlpLoggerProvider(options);
	
	// 3. Register the provider globally
	logs.setGlobalLoggerProvider(loggerProvider);
}

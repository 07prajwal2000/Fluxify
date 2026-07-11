import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { logs } from "@opentelemetry/api-logs";
import {
	resourceFromAttributes,
	defaultResource,
} from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	LoggerProvider,
} from "@opentelemetry/sdk-logs";

export interface OtlpLoggerOptions {
	url: string;
	headers: Record<string, string>;
	serviceName: string;
}

export function createOtlpLoggerProvider({
	url,
	headers,
	serviceName,
}: OtlpLoggerOptions): LoggerProvider {
	// 1. Setup OpenTelemetry OTLP exporter
	const logExporter = new OTLPLogExporter({
		url,
		headers,
	});

	// 2. Setup the LoggerProvider using SDK 2.x factory methods
	return new LoggerProvider({
		resource: defaultResource().merge(
			resourceFromAttributes({
				"service.name": serviceName,
				"stream-name": serviceName,
			}),
		),
		// SimpleLogRecordProcessor ensures logs ship immediately without batch delays during testing
		processors: [
			new BatchLogRecordProcessor(logExporter, {
				exportTimeoutMillis: 20 * 1000,
				maxQueueSize: 100,
			}),
		],
	});
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

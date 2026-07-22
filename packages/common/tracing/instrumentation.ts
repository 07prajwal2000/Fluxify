import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type {
	BatchSpanProcessor,
	SpanProcessor,
	ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { BatchSpanProcessor as _BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import { Resource } from "@opentelemetry/resources";
import { context, createContextKey } from "@opentelemetry/api";
import type { Context } from "@opentelemetry/api";

export { trace, context } from "@opentelemetry/api";
export type { Context, Span } from "@opentelemetry/api";

// Import the internal SDK span type directly from trace-base to satisfy SDK type system
import type { Span as SdkSpan } from "@opentelemetry/sdk-trace-base";

export const FLUXIFY_CONTEXT_KEY = createContextKey("fluxify_context");

export interface FluxifyContextData {
	userQuery?: string;
	action?: string;
}

export function withFluxifyContext<T>(
	data: FluxifyContextData,
	fn: () => T
): T {
	const activeContext = context.active().setValue(FLUXIFY_CONTEXT_KEY, data);
	return context.with(activeContext, fn);
}

class FluxifyContextSpanProcessor implements SpanProcessor {
	forceFlush(): Promise<void> {
		return Promise.resolve();
	}

	shutdown(): Promise<void> {
		return Promise.resolve();
	}

	onStart(span: SdkSpan, _parentContext: Context): void {
		const fluxifyContext = context
			.active()
			.getValue(FLUXIFY_CONTEXT_KEY) as FluxifyContextData;

		if (fluxifyContext) {
			if (fluxifyContext.userQuery) {
				span.setAttribute("fluxify.userQuery", fluxifyContext.userQuery);
			}
			if (fluxifyContext.action) {
				span.setAttribute("fluxify.action", fluxifyContext.action);
			}
		}
	}

	onEnd(_span: ReadableSpan): void {}
}

export interface TracingOptions {
	serviceName: string;
	endpoint: string;
	headers?: Record<string, string>;
	instrumentations?: Instrumentation[];
}

let isInitialized = false;

export function initializeTracing(options: TracingOptions): void {
	if (isInitialized) return;
	if (!options.endpoint) return;

	// Creating resource mapping explicitly conforming to SDK 1.x definitions
	const provider = new NodeTracerProvider({
		resource: new Resource({
			"service.name": options.serviceName,
		}),
	});

	const exporter = new OTLPTraceExporter({
		url: options.endpoint,
		headers: options.headers || {},
		keepAlive: false,
	});

	provider.addSpanProcessor(new FluxifyContextSpanProcessor());
	provider.addSpanProcessor(new _BatchSpanProcessor(exporter));

	(global as any).__tracerProvider = provider;

	provider.register();

	if (options.instrumentations && options.instrumentations.length > 0) {
		registerInstrumentations({
			instrumentations: options.instrumentations,
		});
	}

	isInitialized = true;
}

export async function flushTraces(): Promise<void> {
	if ((global as any).__tracerProvider) {
		try {
			await (global as any).__tracerProvider.forceFlush();
		} catch (e: any) {
			if (e?.message?.includes("Request timed out")) {
				// Silently swallow Bun's http.request keep-alive timeout quirk
				return;
			}
			console.error("OTel flush error:", e);
		}
	}
}

export async function shutdownTraces(): Promise<void> {
	if ((global as any).__tracerProvider) {
		try {
			await (global as any).__tracerProvider.shutdown();
		} catch (e: any) {
			if (e?.message?.includes("Request timed out")) {
				return;
			}
			console.error("OTel shutdown error:", e);
		}
	}
}

// Graceful process exit hooks to safely shutdown the BatchSpanProcessor
process.on("SIGINT", async () => {
	await shutdownTraces();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	await shutdownTraces();
	process.exit(0);
});

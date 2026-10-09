import type { Context } from "@opentelemetry/api";
import { context, createContextKey } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { Resource } from "@opentelemetry/resources";
import type {
	BatchSpanProcessor,
	ReadableSpan,
	SpanExporter,
	SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
	BatchSpanProcessor as _BatchSpanProcessor,
	ParentBasedSampler,
	TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export type { Context, Span } from "@opentelemetry/api";
export { context, trace } from "@opentelemetry/api";

// Import the internal SDK span type directly from trace-base to satisfy SDK type system
import { logger } from "../logging";

export const FLUXIFY_CONTEXT_KEY = createContextKey("fluxify_context");

export interface FluxifyContextData {
	userQuery?: string;
	action?: string;
}

export function withFluxifyContext<T>(data: FluxifyContextData, fn: () => T): T {
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

	onStart(span: any, _parentContext: Context): void {
		const fluxifyContext = context.active().getValue(FLUXIFY_CONTEXT_KEY) as FluxifyContextData;

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
	/** Share of traces kept, 0 to 1 (default all). A span follows its parent's decision. */
	sampleRate?: number;
	/** Builds the processor that feeds the OTLP exporter (default: a batch processor). */
	processor?: (exporter: SpanExporter) => SpanProcessor;
	/** Flush and exit on SIGINT/SIGTERM (default true). Off for a CLI that handles Ctrl+C itself. */
	exitHooks?: boolean;
}

let isInitialized = false;

/** Sets up the global tracer provider once; returns it, or undefined when already set up or no endpoint. */
export function initializeTracing(options: TracingOptions): NodeTracerProvider | undefined {
	if (isInitialized) return;
	if (!options.endpoint) return;

	// Creating resource mapping explicitly conforming to SDK 1.x definitions
	const provider = new NodeTracerProvider({
		resource: new Resource({
			"service.name": options.serviceName,
		}),
		sampler:
			options.sampleRate === undefined
				? undefined
				: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(options.sampleRate) }),
	});

	const exporter = new OTLPTraceExporter({
		url: options.endpoint,
		headers: options.headers || {},
		keepAlive: false,
	});

	provider.addSpanProcessor(new FluxifyContextSpanProcessor());
	provider.addSpanProcessor(options.processor?.(exporter) ?? new _BatchSpanProcessor(exporter));

	(global as any).__tracerProvider = provider;

	provider.register();

	if (options.instrumentations && options.instrumentations.length > 0) {
		registerInstrumentations({
			instrumentations: options.instrumentations,
		});
	}

	if (options.exitHooks !== false) {
		// Graceful process exit hooks to safely shutdown the BatchSpanProcessor
		for (const signal of ["SIGINT", "SIGTERM"] as const)
			process.on(signal, async () => {
				await shutdownTraces();
				process.exit(0);
			});
	}

	isInitialized = true;
	return provider;
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
			logger.error("OTel flush error", "tracing", { error: e });
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
			logger.error("OTel shutdown error", "tracing", { error: e });
		}
	}
}

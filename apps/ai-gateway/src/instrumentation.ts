import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
	BatchSpanProcessor,
	SpanProcessor,
	ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { LangChainInstrumentation } from "@arizeai/openinference-instrumentation-langchain";
import { context, Span, Context, createContextKey } from "@opentelemetry/api";
import {
	LLM_TRACING_ENABLED,
	LLM_OTLP_TRACES_ENDPOINT,
	LLM_OTLP_TRACES_HEADERS,
} from "./lib/env";
import { isMainThread } from "worker_threads";

export const FLUXIFY_CONTEXT_KEY = createContextKey("fluxify_context");

export interface FluxifyContextData {
	userQuery?: string;
	action?: string;
}

class FluxifyContextSpanProcessor implements SpanProcessor {
	forceFlush(): Promise<void> {
		return Promise.resolve();
	}
	shutdown(): Promise<void> {
		return Promise.resolve();
	}
	onStart(span: Span, parentContext: Context): void {
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
	onEnd(span: ReadableSpan): void {}
}

function parseHeaders(
	headersString: string | undefined,
): Record<string, string> {
	if (!headersString) return {};
	const headers: Record<string, string> = {};
	const parts = headersString.split(";");
	for (const part of parts) {
		const colonIndex = part.indexOf(":");
		if (colonIndex !== -1) {
			const key = part.slice(0, colonIndex).trim();
			const value = part.slice(colonIndex + 1).trim();
			if (key && value) {
				headers[key] = value;
			}
		}
	}
	return headers;
}

let isInitialized = false;

export function initializeInstrumentation() {
	if (isInitialized) return;
	if (!LLM_TRACING_ENABLED || !LLM_OTLP_TRACES_ENDPOINT) return;

	const serviceName = isMainThread
		? "fluxify.ai-gateway-main.llm"
		: "fluxify.ai-gateway-worker.llm";

	const provider = new NodeTracerProvider({
		// @ts-ignore
		resource: new Resource({
			"service.name": serviceName,
		}),
	});

	const exporter = new OTLPTraceExporter({
		url: LLM_OTLP_TRACES_ENDPOINT,
		headers: parseHeaders(LLM_OTLP_TRACES_HEADERS),
	});

	// Inject our domain metadata
	// @ts-ignore
	provider.addSpanProcessor(new FluxifyContextSpanProcessor());

	// Export traces
	// @ts-ignore
	provider.addSpanProcessor(new BatchSpanProcessor(exporter));

	provider.register();

	registerInstrumentations({
		instrumentations: [new LangChainInstrumentation()],
	});

	isInitialized = true;
}

// Automatically execute the initialization
initializeInstrumentation();

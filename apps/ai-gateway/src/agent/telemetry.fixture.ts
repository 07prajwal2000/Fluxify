import { OpenInferenceSimpleSpanProcessor } from "@arizeai/openinference-vercel";
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { enableTelemetry } from "./telemetry";

/** Tracing on, spans collected in memory. The same processor as production, minus the network. */
export function collect(recordContent: boolean) {
	const exporter = new InMemorySpanExporter();
	const provider = new NodeTracerProvider();
	provider.addSpanProcessor(new OpenInferenceSimpleSpanProcessor({ exporter }));
	// installs the async context manager, as initializeTracing does in production
	provider.register();
	enableTelemetry(provider.getTracer("test"), recordContent);
	const spans = () => exporter.getFinishedSpans();
	const named = (prefix: string) => spans().filter((s) => s.name.startsWith(prefix));
	return { spans, named };
}

export const kind = (s: ReadableSpan) => s.attributes["openinference.span.kind"];

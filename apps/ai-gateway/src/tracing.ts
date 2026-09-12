import { isMainThread } from "worker_threads";
import { initializeTracing } from "@fluxify/common/tracing";
import { LangChainInstrumentation } from "@arizeai/openinference-instrumentation-langchain";
import * as CallbackManagerModule from "@langchain/core/callbacks/manager";
import {
	LLM_TRACING_ENABLED,
	LLM_OTLP_TRACES_ENDPOINT,
	LLM_OTLP_TRACES_HEADERS,
} from "./lib/env";

function parseHeaders(headersString: string | undefined): Record<string, string> {
	if (!headersString) return {};
	const headers: Record<string, string> = {};
	const parts = headersString.split(";");
	for (const part of parts) {
		const colonIndex = part.indexOf(":");
		if (colonIndex !== -1) {
			const key = part.slice(0, colonIndex).trim();
			const value = part.slice(colonIndex + 1).trim();
			if (key && value) headers[key] = value;
		}
	}
	return headers;
}

const serviceName = isMainThread
	? "fluxify.api-gateway-main"
	: "fluxify.api-gateway-worker";

if (LLM_TRACING_ENABLED && LLM_OTLP_TRACES_ENDPOINT) {
	initializeTracing({
		serviceName: serviceName + ".llm",
		endpoint: LLM_OTLP_TRACES_ENDPOINT,
		headers: parseHeaders(LLM_OTLP_TRACES_HEADERS),
	});

	// Auto-instrumentation cannot work under Bun: OpenTelemetry hooks module
	// loading through import-in-the-middle, whose CJS/ESM interop leaves Bun with
	// a namespace object instead of a constructor, so `new ImportInTheMiddle()`
	// throws "Function is not a constructor" the moment the instrumentation is
	// enabled. Patching the callback manager directly is the supported escape
	// hatch and needs no loader hook.
	//
	// `enabled: false` keeps the constructor from enabling itself, and the
	// instrumentation is deliberately NOT passed to initializeTracing:
	// registerInstrumentations() calls enable() on exactly the instrumentations
	// whose config says disabled, which would put the crash right back.
	const langchain = new LangChainInstrumentation({
		instrumentationConfig: { enabled: false },
	});
	langchain.manuallyInstrument(CallbackManagerModule as any);
}

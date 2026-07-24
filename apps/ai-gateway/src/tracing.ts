import { isMainThread } from "worker_threads";
import { initializeTracing } from "@fluxify/common/tracing";
import { LangChainInstrumentation } from "@arizeai/openinference-instrumentation-langchain";
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
		instrumentations: [new LangChainInstrumentation() as any],
	});
}

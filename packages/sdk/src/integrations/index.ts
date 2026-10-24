export * from "./ai.js";
export * from "./baas.js";
export * from "./database.js";
export * from "./kv.js";
export * from "./mcp.js";
export * from "./observability.js";
export * from "./queue.js";
export type * from "./raw.js";
export * from "./variants.js";

import type { AiAdapter, AiInspectResult } from "./ai.js";
import type { BaasAdapter, BaasInspectResult } from "./baas.js";
import type { DatabaseAdapter, SchemaDetails } from "./database.js";
import type { KvAdapter, KvInspectResult } from "./kv.js";
import type { McpAdapter, McpInspectResult } from "./mcp.js";
import type { ObservabilityAdapter, ObservabilityInspectResult } from "./observability.js";
import type { QueueInspectResult, QueueProducer } from "./queue.js";

/** Built-in group -> adapter contract mapping. */
export interface BuiltInIntegrationAdapters {
	database: DatabaseAdapter;
	kv: KvAdapter;
	queue: QueueProducer;
	ai: AiAdapter;
	observability: ObservabilityAdapter;
	baas: BaasAdapter;
	mcp: McpAdapter;
}

/** Built-in group -> inspect / describe shape mapping. */
export interface BuiltInIntegrationInspectResults {
	database: SchemaDetails;
	kv: KvInspectResult;
	queue: QueueInspectResult;
	ai: AiInspectResult;
	observability: ObservabilityInspectResult;
	baas: BaasInspectResult;
	mcp: McpInspectResult;
}

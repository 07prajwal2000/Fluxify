import { AI_OPS } from "./ai";
import { DATABASE_OPS } from "./database";
import { KV_OPS } from "./kv";
import { OBSERVABILITY_OPS } from "./observability";
import { MCP_OPS, QUEUE_OPS } from "./services";

/** The built-ins' op hooks (test, describe, inspect), keyed `group/variant`. */
export const BUILT_IN_OPS: Record<string, object> = {
	...DATABASE_OPS,
	...KV_OPS,
	...AI_OPS,
	...OBSERVABILITY_OPS,
	...QUEUE_OPS,
	...MCP_OPS,
};

export { KV_VALUE_CAP, type KvValueResult } from "./kv";
export {
	INTEGRATION_OPS,
	type IntegrationOp,
	type IntegrationOpCall,
	IntegrationOpError,
	OP_CANCELLED,
	runIntegrationHook,
} from "./run";
export { expandCfg } from "./services";

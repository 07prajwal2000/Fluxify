// `@fluxify/sdk/triggers`: write a plugin trigger, which waits for a signal and
// hands it to Fluxify to run the attached workflow.

export type { ConnectionOf, IntegrationConnection } from "./src/context.js";
export {
	type TriggerEntry,
	triggerEntryPath,
	triggerEntrySchema,
} from "./src/manifest.js";
export type { IntegrationId } from "./src/params.js";
export type { PollContext, PollOptions, PollTick } from "./src/runtime/poll.js";
export { poll, sleep } from "./src/runtime/poll.js";
export type { EmitOptions, TriggerConnection, TriggerContext } from "./src/runtime/trigger.js";
export { type AnyTrigger, type TriggerDefinition, toTriggerEntry, trigger } from "./src/trigger.js";
export {
	BLOCK_ONLY_FIELDS,
	RESERVED_TRIGGER_PARAM_NAMES,
	TRIGGER_PARAM_TYPES,
} from "./src/validateTrigger.js";

// `@fluxify/sdk/blocks`: write a programmable block.
export * from "./index.js";
export {
	type BlockDefinition,
	block,
	deprecated,
	type ExecuteHandle,
	type RunArgs,
	type RunResult,
	toManifestEntry,
} from "./src/block.js";
export type * from "./src/context.js";
export {
	type BodyHandle,
	type Handles,
	handle,
	type InHandle,
	type OutHandle,
	type OutHandles,
	toHandleSpec,
} from "./src/handles.js";
export {
	type ConnectContext,
	type IntegrationDefinition,
	integration,
	toIntegrationEntry,
} from "./src/integration.js";
export {
	BLOCK_NAME,
	blockEntryPath,
	type FluxifyManifest,
	fluxifyManifestSchema,
	type IntegrationEntry,
	integrationEntryPath,
	integrationEntrySchema,
	type ManifestEntry,
	manifestEntrySchema,
	PLUGIN_NAME,
	paramSchema,
	SDK_RANGE,
	visibleWhenSchema,
} from "./src/manifest.js";
export {
	type ArrayParam,
	type CompiledSchema,
	type Condition,
	type FieldMapParam,
	type HintParam,
	hint,
	type IntegrationId,
	type IntegrationParam,
	type JsonValue,
	type KeyValueParam,
	numberParamProblem,
	type Param,
	type Params,
	type ParamType,
	type ParamValue,
	type ParamValues,
	type Placement,
	param,
	type SecretParam,
	type VisibleWhen,
} from "./src/params.js";
export { RESERVED_PARAM_NAMES } from "./src/validate.js";

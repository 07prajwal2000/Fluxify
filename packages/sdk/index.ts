// `@fluxify/sdk`: the plain-data shapes shared by every resource kind. Block
// authoring lives in `@fluxify/sdk/blocks`.
export { type BodyCorner, type HandleSpec, handleSpecSchema } from "./src/handles.js";
export {
	BLOCK_DATA_KEYS,
	CTX_SPAN_TYPE,
	INVOKE_MODES,
	type InvokeMode,
	MODULE_BLOCK_DATA_KEYS,
} from "./src/reserved.js";

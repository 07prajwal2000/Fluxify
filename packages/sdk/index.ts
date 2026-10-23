// `@fluxify/sdk`: the plain-data shapes shared by every resource kind. Block
// authoring lives in `@fluxify/sdk/blocks`.
export { type BodyCorner, type HandleSpec, handleSpecSchema } from "./src/handles.js";
export {
	blockIdProblem,
	customBlockId,
	longestCustomBlockId,
} from "./src/ids.js";
export { type PluginMeta, pluginMetaSchema } from "./src/manifest.js";
export type { VisibleWhenInput } from "./src/params.js";
export { plugin } from "./src/plugin.js";
export {
	BLOCK_DATA_KEYS,
	CTX_SPAN_TYPE,
	ICON_URL_MAX,
	INVOKE_MODES,
	type InvokeMode,
	MAX_BLOCK_ID_LENGTH,
	MAX_PROJECT_ID_LENGTH,
	MODULE_BLOCK_DATA_KEYS,
} from "./src/reserved.js";
export { GENERAL_TAB, type ParamTab, paramTabs } from "./src/tabs.js";
export { isVisible } from "./src/visible.js";

/** How a canvas may call a block: wait for it, fire it on this worker, or queue it. */
export const INVOKE_MODES = ["sync", "async", "queued"] as const;
export type InvokeMode = (typeof INVOKE_MODES)[number];

/** data keys the engine owns on every library block; the rest of `data` is the block's params */
export const BLOCK_DATA_KEYS = [
	"blockName",
	"blockDescription",
	"invoke",
	"saveAsVariable",
] as const;

/**
 * The data keys the engine owns on a programmable block: the shared ones plus
 * `order`, the canvas branch order of an `allowMultiple` handle. None reaches
 * the block as a param, so a plugin cannot declare a param by these names.
 * A canvas custom block keeps getting `order`: it may be one of its inputs.
 */
export const MODULE_BLOCK_DATA_KEYS = [...BLOCK_DATA_KEYS, "order"] as const;

/** `blockType` of a `ctx.span` child in a trace, so no block may be called this */
export const CTX_SPAN_TYPE = "span";

/** the longest `iconUrl` (a data URL) a custom block may hold; the CLI checks a plugin's icons against it */
export const ICON_URL_MAX = 68266;

import type { BlockContext } from "@fluxify/sdk/blocks";
import type { Context } from "../baseBlock";

/** what a module block's `run` gets: `registerModuleBlock` adds `span` and `pool`, the plugin loader `integrations` */
type ModuleBlockContext = Context & Required<Pick<Context, "span" | "pool" | "integrations">>;
type Assert<T extends true> = T;

/**
 * Compile-time only: the ctx the runtime passes must be the one the SDK
 * promises plugin authors. A field the SDK types that the runtime does not
 * pass (or passes differently) fails the typecheck here.
 */
export type SdkContextMatches = Assert<ModuleBlockContext extends BlockContext ? true : false>;

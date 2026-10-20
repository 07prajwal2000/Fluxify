import { z } from "zod";
import { type PluginMeta, pluginMetaSchema } from "./manifest.js";

/**
 * Describes the plugin: default-export it from `src/index.ts`. The CLI reads
 * it to write `fluxify.json` and checks `package.json` against it. `name`
 * (`scope/name`) is permanent: a different name is a different plugin. Icons
 * are paths inside the plugin, like a block's. Throws on an invalid definition.
 */
export function plugin<const M extends PluginMeta>(meta: M): M {
	const parsed = pluginMetaSchema.safeParse(meta);
	if (!parsed.success)
		throw new Error(`plugin ${String(meta?.name)}: ${z.prettifyError(parsed.error)}`);
	return meta;
}

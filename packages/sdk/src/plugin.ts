import { z } from "zod";
import { type PluginDefinition, pluginDefinitionSchema } from "./manifest.js";

/**
 * Describes the plugin: default-export it from `src/index.ts`. The CLI reads
 * it to write `fluxify.json` and checks `package.json` against it. `name`
 * (`scope/name`) is permanent: a different name is a different plugin. Icons
 * are paths inside the plugin, like a block's. Throws on an invalid definition.
 *
 * `blocks`, `triggers` and `integrations` are the plugin's contents: the build
 * ships what they list and nothing else. Import each from its own file.
 *
 * `name` is also the plugin part of every recorded block id
 * (`<plugin>@<version>:<projectId>:<type>`), so a name (together with its
 * blocks) long enough for that id to exceed `MAX_BLOCK_ID_LENGTH` is refused
 * by `fluxifyManifestSchema` and by `fluxify-cli build` (#952).
 */
export function plugin<const M extends PluginDefinition>(meta: M): M {
	const parsed = pluginDefinitionSchema.safeParse(meta);
	if (!parsed.success)
		throw new Error(`plugin ${String(meta?.name)}: ${z.prettifyError(parsed.error)}`);
	return meta;
}

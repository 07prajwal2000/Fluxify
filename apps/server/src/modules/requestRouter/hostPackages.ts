import * as sdk from "@fluxify/sdk";
import * as sdkBlocks from "@fluxify/sdk/blocks";
import * as sdkIntegrations from "@fluxify/sdk/integrations";
import * as sdkRuntime from "@fluxify/sdk/runtime";
import * as sdkTesting from "@fluxify/sdk/testing";
import * as zod from "zod";

/**
 * Makes a plugin's `import "@fluxify/sdk/..."` and `import "zod"` load this
 * process's own modules (`HOST_PACKAGES`): one runtime contract, one zod.
 *
 * A Bun runtime plugin, not a symlink into the plugin's node_modules: the
 * worker images ship bundles and no node_modules, so there is no host copy on
 * disk to link to. A virtual module hands over the very instance the bundle
 * runs, wherever the plugin's directory is. Plain resolution never runs for
 * these names, so a copy the plugin installed anyway is ignored.
 */
const MODULES: Record<string, object> = {
	"@fluxify/sdk": sdk,
	"@fluxify/sdk/blocks": sdkBlocks,
	"@fluxify/sdk/integrations": sdkIntegrations,
	"@fluxify/sdk/runtime": sdkRuntime,
	"@fluxify/sdk/testing": sdkTesting,
	zod,
	// zod 4's `zod` re-exports `zod/v4`: the same instances
	"zod/v4": zod,
};

let provided = false;

/** Idempotent; call before importing any plugin code. */
export function provideHostPackages() {
	if (provided) return;
	provided = true;
	Bun.plugin({
		name: "fluxify-host-packages",
		setup(build) {
			for (const [specifier, exports] of Object.entries(MODULES))
				build.module(specifier, () => ({
					exports: exports as Record<string, unknown>,
					loader: "object",
				}));
		},
	});
}

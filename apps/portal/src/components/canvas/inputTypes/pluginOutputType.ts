import type { PluginBlockDef } from "../plugins/pluginBlocks";

/**
 * What a plugin block declares for its `kind` handle (`source`, `success` or
 * `failure`), or null when it says nothing. One string types the block's first
 * output; an object types each handle by name. Body handles are never typed.
 */
export function declaredOutput(def: PluginBlockDef, kind: string): string | null {
	const { output } = def.entry;
	const type =
		typeof output === "string"
			? kind === def.handles.out[0]
				? output
				: ""
			: output?.[kind as "source"];
	return type?.trim() ? type : null;
}

/**
 * The lookup the resolver reads (`InputTypeContext.pluginOutput`). A declared
 * type may name packages (`import("pkg").Type`), so the first time one is used
 * its packages' types are loaded into the editor.
 */
export function makePluginOutput(
	byType: Record<string, PluginBlockDef | undefined>,
	loadPackage: (name: string, version: string) => unknown,
) {
	return (type: string, kind: string): string | null => {
		const def = byType[type];
		const declared = def ? declaredOutput(def, kind) : null;
		if (def && declared !== null)
			for (const [name, version] of Object.entries(def.entry.outputPackages ?? {}))
				loadPackage(name, version);
		return declared;
	};
}

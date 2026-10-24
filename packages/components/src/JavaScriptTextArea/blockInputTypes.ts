import { useEffect } from "react";

const ID = "fluxify-block-input";
const VIRTUAL_PATH = "file:///fluxify-block-input.d.ts";

/**
 * The declaration that types `input` for the block whose settings are open.
 * Merges into the empty `FluxifyBlockInput` the globals declare, so no type
 * means `any`, exactly as before.
 */
export function buildBlockInputTypeLib(type: string | null | undefined): string {
	const trimmed = type?.trim();
	if (!trimmed || trimmed === "any") return "";
	return `declare interface FluxifyBlockInput { value: ${trimmed} }\n`;
}

/**
 * Types `input` while the component is mounted. Monaco's extra libs are global,
 * so mount this once, for the one block the panel shows, and every editor of
 * that block (script, inline `js:` fields, expanded modal) shares the type.
 */
export function useBlockInputType(type: string | null | undefined) {
	const lib = buildBlockInputTypeLib(type);

	useEffect(() => {
		if (!lib) return;
		let live = true;
		const registry = import("./typeLibRegistry");
		void registry.then((module) => {
			if (live) module.registerTypeLib(ID, lib, VIRTUAL_PATH);
		});
		return () => {
			live = false;
			void registry.then((module) => module.unregisterTypeLib(ID));
		};
	}, [lib]);
}

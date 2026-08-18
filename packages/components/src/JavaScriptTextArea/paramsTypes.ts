import { useEffect, useMemo } from "react";

/**
 * `params` inside a custom block's canvas is the caller's configuration — the
 * block's own `inputParams`, filled in by whoever placed the block. Only the
 * canvas of that block sees it, so the declaration is registered per block
 * rather than living in the static globals.
 */
export type CustomBlockParamDef = {
	name: string;
	type: string;
	label?: string;
	description?: string | null;
	options?: (string | { label?: string; value: string })[];
};

const ID = "fluxify-custom-block-params";
const VIRTUAL_PATH = "file:///fluxify-custom-block-params.d.ts";

/** An integration id is opaque — the value is resolved by the runtime, and
 *  nothing in an expression does anything useful with it, so it is left out. */
const SKIPPED_TYPES = new Set(["integration_selector"]);

const quote = (value: string) => JSON.stringify(String(value));

function typeOf(param: CustomBlockParamDef): string {
	switch (param.type) {
		case "checkbox":
			return "boolean";
		case "array_editor":
			return "unknown[]";
		case "dropdown": {
			const values = (param.options ?? []).map((option) =>
				typeof option === "string" ? option : option?.value,
			);
			const literals = [...new Set(values.filter(Boolean))].map(quote as (v: unknown) => string);
			return literals.length > 0 ? literals.join(" | ") : "string";
		}
		// `app_config_selector` holds the config *key*, read with `getConfig()`
		default:
			return "string";
	}
}

/** A safe object key, and a doc comment when the param carries anything to say. */
function member(param: CustomBlockParamDef): string {
	const doc = [param.label, param.description].filter(Boolean).join(" — ");
	const key = /^[A-Za-z_$][\w$]*$/.test(param.name) ? param.name : quote(param.name);
	return `${doc ? `  /** ${doc.replace(/\*\//g, "*\/")} */\n` : ""}  ${key}: ${typeOf(param)};`;
}

export function buildParamsTypeLib(params: CustomBlockParamDef[]): string {
	const members = params
		.filter((param) => param?.name && !SKIPPED_TYPES.has(param.type))
		.map(member);
	return `/** Caller configuration for this custom block. */\ndeclare const params: {\n${members.join("\n")}\n};\n`;
}

/**
 * Registers `params` with Monaco for as long as the component is mounted. The
 * registry is imported lazily on purpose: it pulls in Monaco, which the editor
 * itself only loads when one is actually opened.
 */
export function useCustomBlockParamsTypes(params: CustomBlockParamDef[] | undefined) {
	const lib = useMemo(
		() => (params && params.length > 0 ? buildParamsTypeLib(params) : ""),
		[params],
	);

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

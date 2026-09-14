import { useEffect, useMemo } from "react";
import {
	collectVariables,
	describeVariable,
	type CanvasVariable,
} from "../JsTextField/snippets/variableSnippets";

const ID = "fluxify-canvas-variables";
const VIRTUAL_PATH = "file:///fluxify-canvas-variables.d.ts";

// reserved words are filtered by the caller (portal), which owns the shared list
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Ambient declarations for the variables blocks on the canvas write, so the
 * editor autocompletes them. The JSDoc matches the snippet description.
 */
export function buildCanvasVariableTypeLib(variables?: CanvasVariable[]): string {
	const globals: string[] = [];
	const outputs: string[] = [];
	for (const { name, sources, output } of collectVariables(variables)) {
		if (!IDENTIFIER.test(name)) continue;
		// a block name holding `*/` must not close the comment early
		const doc = describeVariable(name, sources, "from execution state", output).replaceAll("*/", "*\\/");
		if (output) outputs.push(`\t/** ${doc} */\n\t${name}: any;\n`);
		else globals.push(`/** ${doc} */\ndeclare var ${name}: any;\n`);
	}
	if (outputs.length) {
		globals.push(`/** Block outputs saved in this request */\ndeclare var outputs: {\n${outputs.join("")}};\n`);
	}
	return globals.join("\n");
}

/** Registers the canvas variable declarations in Monaco while mounted. */
export function useCanvasVariableTypes(variables?: CanvasVariable[]) {
	const lib = useMemo(
		() => buildCanvasVariableTypeLib(variables),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[JSON.stringify(variables)],
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

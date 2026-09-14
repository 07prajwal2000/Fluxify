import { useEffect, useMemo } from "react";
import {
	collectVariables,
	describeVariable,
	type CanvasVariable,
} from "../JsTextField/snippets/variableSnippets";

const ID = "fluxify-canvas-variables";
const VIRTUAL_PATH = "file:///fluxify-canvas-variables.d.ts";

// ponytail: reserved words (`class`, `new`) pass this and would break the lib; filter them if a user hits it
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Ambient declarations for the variables blocks on the canvas write, so the
 * editor autocompletes them. The JSDoc matches the snippet description.
 */
export function buildCanvasVariableTypeLib(variables?: CanvasVariable[]): string {
	return collectVariables(variables)
		.filter(({ name }) => IDENTIFIER.test(name))
		.map(({ name, sources }) => {
			// a block name holding `*/` must not close the comment early
			const doc = describeVariable(name, sources, "from execution state").replaceAll("*/", "*\\/");
			return `/** ${doc} */\ndeclare var ${name}: any;\n`;
		})
		.join("\n");
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

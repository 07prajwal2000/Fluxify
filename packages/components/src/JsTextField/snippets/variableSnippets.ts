import { useMemo } from "react";
import { toIdentifier, useRegisterSnippets } from "./snippetRegistry";
import type { CodeSnippet } from "./types";

export function buildVariableAccessSnippet(varName: string): CodeSnippet {
	const ident = toIdentifier(varName);
	return {
		id: `var-access-${varName}`,
		title: `Access: ${varName}`,
		description: `Read context variable "${varName}" from execution scope`,
		category: "variables",
		code: `const ${ident} = ${ident};`,
		tags: ["variable", "context", varName],
	};
}

export function buildVariableFallbackSnippet(varName: string): CodeSnippet {
	const ident = toIdentifier(varName);
	return {
		id: `var-fallback-${varName}`,
		title: `Access with Fallback: ${varName}`,
		description: `Read context variable "${varName}" with default fallback`,
		category: "variables",
		code: `const ${ident} = ${ident} ?? "default_value";`,
		tags: ["variable", "fallback", varName],
	};
}

export function buildVariableAssignInputSnippet(varName: string): CodeSnippet {
	const ident = toIdentifier(varName);
	return {
		id: `var-assign-input-${varName}`,
		title: `Set Variable: ${varName}`,
		description: `Assign preceding block output or property to "${varName}"`,
		category: "variables",
		code: `${ident} = input?.${ident} ?? input;`,
		tags: ["variable", "input", "assign", varName],
	};
}

export function buildVariableMergeSnippet(varName: string): CodeSnippet {
	const ident = toIdentifier(varName);
	return {
		id: `var-merge-${varName}`,
		title: `Merge into: ${varName}`,
		description: `Access existing "${varName}" and merge updates from input`,
		category: "variables",
		code: `const existing = typeof ${ident} === "object" && ${ident} !== null ? ${ident} : {};\n${ident} = { ...existing, ...(typeof input === "object" ? input : { value: input }) };`,
		tags: ["variable", "merge", "update", varName],
	};
}

export function buildVariableConditionalSnippet(varName: string): CodeSnippet {
	const ident = toIdentifier(varName);
	return {
		id: `var-conditional-${varName}`,
		title: `Conditional Assign: ${varName}`,
		description: `Assign value to "${varName}" based on condition`,
		category: "variables",
		code: `if (input?.success) {\n  ${ident} = input.data;\n} else {\n  ${ident} = "default_value";\n}`,
		tags: ["variable", "conditional", varName],
	};
}

/** A canvas variable, optionally with the name of the block that writes it. */
/** `output` marks a saved block output, read as `outputs.<name>` rather than a global. */
export type CanvasVariable = string | { name: string; source?: string; output?: boolean };

/** Trims, drops blanks and `exclude`, and merges duplicates, keeping every block that writes a name. */
export function collectVariables(variables: CanvasVariable[] | undefined, exclude?: string) {
	const byKey = new Map<string, { name: string; sources: Set<string>; output: boolean }>();
	for (const variable of variables ?? []) {
		const name = (typeof variable === "string" ? variable : variable?.name)?.trim();
		const output = typeof variable !== "string" && variable.output === true;
		// `exclude` is the Set Var key being edited, a global
		if (!name || (!output && name === exclude)) continue;
		const key = `${output ? "outputs." : ""}${name}`;
		const entry = byKey.get(key) ?? { name, sources: new Set<string>(), output };
		const source = typeof variable === "string" ? undefined : variable.source?.trim();
		if (source) entry.sources.add(source);
		byKey.set(key, entry);
	}
	return Array.from(byKey.values(), (v) => ({ ...v, sources: [...v.sources] }));
}

export function describeVariable(
	name: string,
	sources: string[],
	fallback: string,
	output = false,
) {
	const origin = sources.length
		? `set by ${sources.map((source) => `"${source}"`).join(", ")}`
		: fallback;
	return output
		? `Read saved output "outputs.${name}" ${origin}`
		: `Read context variable "${name}" ${origin}`;
}

/** How a script reads the variable: a global, or a key under `outputs`. */
function readExpression(name: string, output: boolean) {
	return output ? `outputs.${name}` : toIdentifier(name);
}

/**
 * Builds dynamic code snippets for a Set Variable block.
 * When a variable name is configured, provides snippets for reading, defaulting,
 * assigning from input, merging, and condition-based assignment.
 * When other canvas variables are available, includes snippets to access them.
 */
export function buildSetVarSnippets(
	variableName?: string,
	otherVariables?: CanvasVariable[],
): CodeSnippet[] {
	const snippets: CodeSnippet[] = [];
	const trimmedName = variableName?.trim();

	if (trimmedName) {
		snippets.push(
			buildVariableAssignInputSnippet(trimmedName),
			buildVariableAccessSnippet(trimmedName),
			buildVariableFallbackSnippet(trimmedName),
			buildVariableMergeSnippet(trimmedName),
			buildVariableConditionalSnippet(trimmedName),
		);
	} else {
		// Generic variable helpers when no variable name is specified yet
		snippets.push(
			{
				id: "var-assign-input-generic",
				title: "Set Context Variable",
				description: "Assign value directly to a global variable",
				category: "variables",
				code: "myVar = input?.value ?? input;",
				tags: ["variable", "input", "assign"],
			},
			{
				id: "var-access-generic",
				title: "Access Context Variable",
				description: "Read a variable from execution scope",
				category: "variables",
				code: "const val = myVar;",
				tags: ["variable", "context"],
			},
		);
	}

	const others = collectVariables(otherVariables, trimmedName);
	const lines: string[] = [];

	for (const { name: other, sources, output } of others) {
		const code = `const ${toIdentifier(other)} = ${readExpression(other, output)};`;
		lines.push(code);
		snippets.push({
			id: `${output ? "var-output" : "var-context"}-${other}`,
			title: `${output ? "Output" : "Variable"}: ${other}`,
			description: describeVariable(other, sources, "set by another block", output),
			category: "variables",
			code,
			tags: ["variable", "context", other, ...sources],
		});
	}

	if (others.length > 1) {
		snippets.push({
			id: "var-context-all",
			title: "All Context Variables",
			description: `Read all ${others.length} context variables from state`,
			category: "variables",
			code: lines.join("\n"),
			tags: ["variable", ...others.map((v) => v.name)],
		});
	}

	return snippets;
}

const SETVAR_SNIPPETS_ID = "fluxify-setvar-snippets";

/**
 * Hook to automatically register dynamic snippets in the Set Variable block
 * on mount/name change, and unregister on unmount.
 */
export function useSetVarSnippets(variableName?: string, otherVariables?: CanvasVariable[]): void {
	const serializedOthers = JSON.stringify(otherVariables);
	const snippets = useMemo(
		() => buildSetVarSnippets(variableName, otherVariables),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[variableName, serializedOthers],
	);

	useRegisterSnippets(SETVAR_SNIPPETS_ID, snippets);
}

/**
 * Builds simple variable access snippets for variables present on canvas.
 */
export function buildCanvasVariableSnippets(variables?: CanvasVariable[]): CodeSnippet[] {
	return collectVariables(variables).map(({ name, sources, output }) => {
		return {
			id: `${output ? "canvas-output" : "canvas-var"}-${name}`,
			title: `${output ? "Output" : "Variable"}: ${name}`,
			description: describeVariable(name, sources, "from execution state", output),
			category: "variables",
			code: `const ${toIdentifier(name)} = ${readExpression(name, output)};`,
			tags: ["variable", "context", name, ...sources],
		};
	});
}

const CANVAS_VARIABLES_ID = "fluxify-canvas-variables";

/**
 * Hook to automatically register context variable snippets across the active canvas.
 */
export function useCanvasVariableSnippets(variables?: CanvasVariable[]): void {
	const serializedVars = JSON.stringify(variables);
	const snippets = useMemo(
		() => buildCanvasVariableSnippets(variables),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[serializedVars],
	);

	useRegisterSnippets(CANVAS_VARIABLES_ID, snippets);
}

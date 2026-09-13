import { useMemo } from "react";
import type { CodeSnippet } from "./types";
import { toIdentifier, useRegisterSnippets } from "./snippetRegistry";

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

/**
 * Builds dynamic code snippets for a Set Variable block.
 * When a variable name is configured, provides snippets for reading, defaulting,
 * assigning from input, merging, and condition-based assignment.
 * When other canvas variables are available, includes snippets to access them.
 */
export function buildSetVarSnippets(
	variableName?: string,
	otherVariables?: string[],
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

	const validOthers = Array.from(
		new Set(
			(otherVariables ?? [])
				.map((v) => v?.trim())
				.filter((v): v is string => Boolean(v) && v !== trimmedName),
		),
	);

	for (const other of validOthers) {
		const otherIdent = toIdentifier(other);
		snippets.push({
			id: `var-context-${other}`,
			title: `Variable: ${other}`,
			description: `Read context variable "${other}" set by another block`,
			category: "variables",
			code: `const ${otherIdent} = ${otherIdent};`,
			tags: ["variable", "context", other],
		});
	}

	if (validOthers.length > 1) {
		const lines = validOthers.map(
			(v) => `const ${toIdentifier(v)} = ${toIdentifier(v)};`,
		);
		snippets.push({
			id: "var-context-all",
			title: "All Context Variables",
			description: `Read all ${validOthers.length} context variables from state`,
			category: "variables",
			code: lines.join("\n"),
			tags: ["variable", ...validOthers],
		});
	}

	return snippets;
}

const SETVAR_SNIPPETS_ID = "fluxify-setvar-snippets";

/**
 * Hook to automatically register dynamic snippets in the Set Variable block
 * on mount/name change, and unregister on unmount.
 */
export function useSetVarSnippets(
	variableName?: string,
	otherVariables?: string[],
): void {
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
export function buildCanvasVariableSnippets(variables?: string[]): CodeSnippet[] {
	const valid = Array.from(
		new Set((variables ?? []).map((v) => v?.trim()).filter(Boolean)),
	);
	return valid.map((v) => {
		const ident = toIdentifier(v!);
		return {
			id: `canvas-var-${v}`,
			title: `Variable: ${v}`,
			description: `Read context variable "${v}" from execution state`,
			category: "variables",
			code: `const ${ident} = ${ident};`,
			tags: ["variable", "context", v!],
		};
	});
}

const CANVAS_VARIABLES_ID = "fluxify-canvas-variables";

/**
 * Hook to automatically register context variable snippets across the active canvas.
 */
export function useCanvasVariableSnippets(variables?: string[]): void {
	const serializedVars = JSON.stringify(variables);
	const snippets = useMemo(
		() => buildCanvasVariableSnippets(variables),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[serializedVars],
	);

	useRegisterSnippets(CANVAS_VARIABLES_ID, snippets);
}

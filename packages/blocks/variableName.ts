/**
 * Variable name rules shared by the compiler, the canvas save validator and the
 * portal field. No imports, so the portal can load it without the blocks barrel.
 */

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Words JS reserves, in any mode, plus the literals and bindings that cannot be assigned. */
export const RESERVED_WORDS = new Set([
	"await", "break", "case", "catch", "class", "const", "continue", "debugger",
	"default", "delete", "do", "else", "enum", "export", "extends", "false",
	"finally", "for", "function", "if", "implements", "import", "in",
	"instanceof", "interface", "let", "new", "null", "package", "private",
	"protected", "public", "return", "static", "super", "switch", "this",
	"throw", "true", "try", "typeof", "var", "void", "while", "with", "yield",
	"arguments", "eval", "undefined", "NaN", "Infinity",
]);

/** Why `name` (already trimmed) can't be a variable, or undefined when it can. */
export function variableNameError(name: string): string | undefined {
	if (!name) return "Variable name is required";
	if (!IDENTIFIER.test(name)) {
		return "Variable name must start with a letter, _ or $ and contain only letters, digits, _ and $";
	}
	if (RESERVED_WORDS.has(name)) {
		return `"${name}" is a reserved JavaScript word and cannot be used as a variable name`;
	}
	return undefined;
}

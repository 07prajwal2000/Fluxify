import { CODE_FIELDS } from "@fluxify/blocks/literalExpressions";
import { RESERVED_WORDS } from "@fluxify/blocks/variableName";
import { FLUXIFY_JS_GLOBALS } from "@fluxify/components";

type Data = Record<string, unknown>;

/** every string in a block's data that is JavaScript: its code field and each `js:` value */
export function* codeIn(type: string, data: Data): Generator<string> {
	const codeField = CODE_FIELDS[type];
	const walk = function* (value: unknown, field: string): Generator<string> {
		if (typeof value === "string") {
			if (field === codeField || value.startsWith("js:")) yield value;
		} else if (value && typeof value === "object") {
			for (const item of Object.values(value)) yield* walk(item, field);
		}
	};
	for (const [field, value] of Object.entries(data)) yield* walk(value, field);
}

/** Comments and string literals hold names that are not reads or writes. */
export const withoutTextOrComments = (code: string) =>
	code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, " ");

const IDENT = /[A-Za-z_$][\w$]*/y;
const IDENTS = /[A-Za-z_$][\w$]*/g;

/** The names a runtime already provides, or that no script means as its own variable. */
const NOT_VARIABLES = new Set([
	...RESERVED_WORDS,
	...[
		...FLUXIFY_JS_GLOBALS.matchAll(/^declare\s+(?:function|const|var|let|class)\s+([\w$]+)/gm),
	].map((m) => m[1]),
	..."input params outputs vars cfg ctx lib console Math JSON Date Object Array String Number Boolean Promise Error RegExp Map Set Symbol BigInt parseInt parseFloat isNaN isFinite setTimeout setInterval clearTimeout clearInterval fetch process Bun globalThis window undefined NaN Infinity structuredClone URL Buffer".split(
		" ",
	),
]);

/** the index just past the bracket that closes the one at `open` */
function closing(code: string, open: number): number {
	let depth = 0;
	for (let i = open; i < code.length; i++) {
		if ("([{".includes(code[i])) depth++;
		else if (")]}".includes(code[i]) && --depth === 0) return i + 1;
	}
	return code.length;
}

/**
 * The names a `let` / `const` / `var` statement declares: the one after the
 * keyword, each one after a top-level comma, and everything inside a
 * destructuring pattern. `start` is just past the keyword.
 */
function declarators(code: string, start: number, names: Set<string>) {
	let depth = 0;
	let expectName = true;
	for (let i = start; i < code.length; i++) {
		const ch = code[i];
		if (depth === 0 && expectName) {
			if (/\s/.test(ch)) continue;
			if (ch === "[" || ch === "{") {
				const end = closing(code, i);
				for (const m of code.slice(i, end).matchAll(IDENTS)) names.add(m[0]);
				i = end - 1;
			} else {
				IDENT.lastIndex = i;
				const found = IDENT.exec(code);
				if (!found) return;
				names.add(found[0]);
				i += found[0].length - 1;
			}
			expectName = false;
		} else if ("([{".includes(ch)) {
			depth++;
		} else if (")]}".includes(ch)) {
			if (depth === 0) return;
			depth--;
		} else if (depth === 0) {
			if (ch === ",") expectName = true;
			else if (ch === ";") return;
			else if (ch === "\n" && !/[,=+\-*/&|?:]\s*$/.test(code.slice(start, i))) return;
		}
	}
}

/** Everything the script declares for itself: variables, functions, classes, parameters, `catch`. */
function declaredNames(code: string): Set<string> {
	const names = new Set<string>();
	const addAll = (text: string) => {
		for (const m of text.matchAll(IDENTS)) names.add(m[0]);
	};
	for (const m of code.matchAll(/\b(?:let|const|var)\b/g)) {
		declarators(code, (m.index ?? 0) + m[0].length, names);
	}
	for (const m of code.matchAll(/\b(?:function\s*\*?|class)\s+([A-Za-z_$][\w$]*)/g)) {
		names.add(m[1]);
	}
	for (const m of code.matchAll(/\bfunction\s*\*?\s*[\w$]*\s*\(([^)]*)\)/g)) addAll(m[1]);
	for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) addAll(m[1]);
	for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
	for (const m of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
	return names;
}

/** `name =`, `name +=`, `name ||=`, `name++`; not `==`, `=>`, or a member (`a.name =`). */
const ASSIGNMENT =
	/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?:(?:\*\*|<<|>>>?|\|\||&&|\?\?|[-+*/%&|^])?=(?![=>])|\+\+|--)/g;

const cache = new Map<string, string[]>();
const MAX_CACHED = 500;

/**
 * The globals a script creates by assigning to a name it never declares, like
 * `myVar = ""` to hand a value to a later block. A name the script declares
 * anywhere with `let`, `const` or `var` (or as a function, class, parameter or
 * `catch` variable) is its own, even where it is assigned: it is no global.
 * Runtime names (`input`, `getHeader`, ...) and JS built-ins never count.
 */
export function assignedGlobals(source: string): string[] {
	const hit = cache.get(source);
	if (hit) return hit;
	const code = withoutTextOrComments(source.replace(/^\s*js:/, "")).replace(
		/`(?:\\.|[^`\\])*`/g,
		" ",
	);
	const declared = declaredNames(code);
	const found = new Set<string>();
	for (const m of code.matchAll(ASSIGNMENT)) {
		if (!declared.has(m[1]) && !NOT_VARIABLES.has(m[1])) found.add(m[1]);
	}
	const names = [...found];
	if (cache.size >= MAX_CACHED) cache.clear();
	cache.set(source, names);
	return names;
}

/** The globals every script of a block assigns. */
export function blockAssignedGlobals(type: string, data: Data): string[] {
	const names = new Set<string>();
	for (const code of codeIn(type, data)) for (const name of assignedGlobals(code)) names.add(name);
	return [...names];
}

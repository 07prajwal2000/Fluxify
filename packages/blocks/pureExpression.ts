/**
 * User code that is a single `return <expression>` over `input` and `params`,
 * as plain JS that can be inlined: no async function, no `with` scope, no
 * promise per evaluation (#944). Anything else returns undefined and keeps the
 * wrapped form, so this only has to recognise the common case, never every one.
 *
 * Accepted: literals, template strings, object and array literals, property
 * and index reads, operators.
 * Rejected: any other free name (a graph variable or a global resolves through
 * the scope proxy), calls, `new`, assignment, `++`/`--`, `await`, `this`,
 * spread, computed keys, methods, arrow functions, regex literals and comments.
 * A call is the line: its result might be a promise the wrapper would have awaited.
 */
export function pureExpression(code: string, rename: Record<string, string>) {
	// a line break right after `return` returns undefined (ASI), so only spaces may follow it
	const body = /^\s*return[ \t]+([\s\S]*?);?\s*$/.exec(code)?.[1];
	return body === undefined ? undefined : expression(body, rename);
}

const NAMES = new Set(["null", "true", "false", "undefined", "typeof"]);
// longest first, so `!==` is not read as `!` then `==`
const PUNCTUATORS = [
	"!==",
	"===",
	"?.",
	"!=",
	"==",
	"<=",
	">=",
	"&&",
	"||",
	"??",
	"!",
	"<",
	">",
	"+",
	"-",
	"*",
	"/",
	"%",
	"(",
	")",
	"[",
	"]",
	"?",
	":",
	",",
	".",
];
const IDENT = /^[A-Za-z_$][\w$]*/;
const NUMBER =
	/^(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)n?/;
/** a token that ends an operand: after it `/` divides */
const OPERAND = /^(?:[\w$]+|\)|\]|`.*|".*|'.*)$/s;
/** a token after which `(` would be a call */
const CALLABLE = /^(?:[A-Za-z_$][\w$]*|\)|\]|`.*)$/s;

/** an open `(`/`[`, or an object literal and where its next token falls */
type Frame = { object: false } | { object: true; at: "key" | "colon" | "value"; key: string };

function expression(source: string, rename: Record<string, string>): string | undefined {
	let out = "";
	let previous = "";
	let i = 0;
	const frames: Frame[] = [];
	while (i < source.length) {
		const rest = source.slice(i);
		const space = /^\s+/.exec(rest)?.[0];
		if (space) {
			out += space;
			i += space.length;
			continue;
		}
		let token: string | undefined;
		let emitted: string | undefined;
		const ident = IDENT.exec(rest)?.[0];
		const number = NUMBER.exec(rest)?.[0];
		const frame = frames.at(-1);
		if (frame?.object && frame.at === "key") {
			// a key is a name, never a variable: `{ input: 1 }` keeps its key
			if (rest[0] === "}") {
				frames.pop();
				token = emitted = "}";
			} else {
				token = emitted =
					ident ?? number ?? (rest[0] === '"' || rest[0] === "'" ? quoted(rest) : undefined);
				if (!token) return undefined;
				frame.at = "colon";
				frame.key = ident ?? "";
			}
		} else if (frame?.object && frame.at === "colon") {
			if (rest[0] === ":") {
				frame.at = "value";
				token = emitted = ":";
			} else if ((rest[0] === "," || rest[0] === "}") && Object.hasOwn(rename, frame.key)) {
				// shorthand `{ input }`: the value is the variable
				out += `: (${rename[frame.key]})`;
				frame.at = "value";
				continue;
			} else return undefined;
		} else if (rest.startsWith("...")) {
			// spread reads like `.name` to this scan; leave it to the wrapper
			return undefined;
		} else if (rest[0] === "{") {
			if (OPERAND.test(previous) && previous !== "typeof") return undefined;
			frames.push({ object: true, at: "key", key: "" });
			token = emitted = "{";
		} else if (frame?.object && rest[0] === "," && frame.at === "value") {
			frame.at = "key";
			token = emitted = ",";
		} else if (rest[0] === "}") {
			if (!frame?.object) return undefined;
			frames.pop();
			token = emitted = "}";
		} else if (ident) {
			token = ident;
			// after `.` or `?.` a name is a property, not a variable
			if (previous === "." || previous === "?.") emitted = ident;
			else if (Object.hasOwn(rename, ident)) emitted = `(${rename[ident]})`;
			else if (NAMES.has(ident)) emitted = ident;
			else return undefined;
		} else if (number) {
			token = emitted = number;
		} else if (rest[0] === '"' || rest[0] === "'") {
			token = emitted = quoted(rest);
		} else if (rest[0] === "`") {
			// right after an operand, a template is a tagged call
			if (OPERAND.test(previous) && previous !== "typeof") return undefined;
			token = template(rest);
			emitted = token && templateWith(token, rename);
		} else if (
			rest.startsWith("++") ||
			rest.startsWith("--") ||
			rest.startsWith("//") ||
			rest.startsWith("/*")
		) {
			return undefined;
		} else {
			token = emitted = PUNCTUATORS.find((p) => rest.startsWith(p));
			// `?.(` is a call too; `?.[` and `?.name` are reads
			if (token === "(" && (CALLABLE.test(previous) || previous === "?.")) return undefined;
			// where an operand is due, `/` starts a regex literal, whose text must not be renamed
			if (token === "/" && (!OPERAND.test(previous) || previous === "typeof")) return undefined;
			if (token === "(" || token === "[") frames.push({ object: false });
			if ((token === ")" || token === "]") && frames.pop()?.object !== false) return undefined;
		}
		if (!token || emitted === undefined) return undefined;
		out += emitted;
		previous = token;
		i += token.length;
	}
	return out.trim() && !frames.length ? `(${out.trim()})` : undefined;
}

/** a whole `"..."` / `'...'` literal from the start of `s`, or undefined if unterminated */
function quoted(s: string) {
	for (let i = 1; i < s.length; i++) {
		if (s[i] === "\\") i++;
		else if (s[i] === "\n") return undefined;
		else if (s[i] === s[0]) return s.slice(0, i + 1);
	}
	return undefined;
}

/** a whole template literal from the start of `s`, `${}` included */
function template(s: string) {
	let depth = 0;
	for (let i = 1; i < s.length; i++) {
		const c = s[i];
		if (c === "\\") i++;
		else if (depth === 0 && c === "`") return s.slice(0, i + 1);
		else if (depth === 0 && c === "$" && s[i + 1] === "{") {
			depth = 1;
			i++;
		} else if (depth > 0) {
			if (c === "{") depth++;
			else if (c === "}") depth--;
			// a string or nested template inside `${}` may hold braces; reject rather than track them
			else if (c === "`" || c === '"' || c === "'") return undefined;
		}
	}
	return undefined;
}

/** the template with each `${}` checked and renamed like any other expression */
function templateWith(literal: string, rename: Record<string, string>) {
	let out = "";
	let i = 0;
	while (i < literal.length) {
		const at = literal.indexOf("${", i);
		if (at === -1 || isEscaped(literal, at)) {
			if (at === -1) return out + literal.slice(i);
			out += literal.slice(i, at + 2);
			i = at + 2;
			continue;
		}
		// the `}` that closes this `${`; template() already refused quotes inside it
		let end = at + 2;
		for (let depth = 1; depth > 0; end++) {
			if (literal[end] === "{") depth++;
			else if (literal[end] === "}") depth--;
		}
		end--;
		const inner = expression(literal.slice(at + 2, end), rename);
		if (inner === undefined) return undefined;
		out += `${literal.slice(i, at)}\${${inner}}`;
		i = end + 1;
	}
	return out;
}

function isEscaped(s: string, at: number) {
	let slashes = 0;
	for (let i = at - 1; s[i] === "\\"; i--) slashes++;
	return slashes % 2 === 1;
}

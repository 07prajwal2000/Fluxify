/**
 * A field value carries its own mode: anything starting with `js:` is a
 * JavaScript expression, everything else is a literal. The engine reads the
 * same prefix, so this is the one place the convention is spelled out.
 */
export const JS_PREFIX = "js:";

export function isJsExpression(value: string | undefined | null): boolean {
	return (value ?? "").startsWith(JS_PREFIX);
}

/** The code behind the prefix — empty string for a literal value. */
export function readExpression(value: string | undefined | null): string {
	const text = value ?? "";
	return text.startsWith(JS_PREFIX) ? text.slice(JS_PREFIX.length) : "";
}

/** Wraps code back into a stored value. */
export function writeExpression(code: string): string {
	return `${JS_PREFIX}${code}`;
}

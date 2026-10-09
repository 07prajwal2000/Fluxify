/**
 * How a failed check shows what it found (#716). A message that reads
 * "got:" with nothing after it sends the author off to fire a real call just to
 * see the response.
 */

const MAX_CHARS = 300;
const MAX_KEYS = 20;

/** `a.b[0].c` as ["a", "b", "0", "c"] */
export function pathParts(path?: string | null) {
	return (path ?? "")
		.replace(/\[(\d+)\]/g, ".$1")
		.split(".")
		.filter(Boolean);
}

const cut = (text: string) =>
	text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}… (${text.length} chars)` : text;

/** a value as the message prints it: strings quoted, null spelled out, objects as cut JSON */
export function showValue(value: unknown): string {
	if (typeof value !== "string" && typeof value !== "object") return String(value);
	try {
		return cut(JSON.stringify(value));
	} catch {
		return cut(String(value));
	}
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** where a check looked: the thing it reads (`label`) and the path into it */
export type Lookup = { root: unknown; parts: string[]; label: string };

/**
 * For a path that leads nowhere: the first part that is missing, and what sits
 * at that level instead ("body has: message, errors").
 */
export function notFound({ root, parts, label }: Lookup) {
	let at = root;
	const seen: string[] = [];
	for (const part of parts) {
		if (isObject(at) && part in at) {
			at = at[part];
			seen.push(part);
			continue;
		}
		const where = seen.length ? seen.join(".") : label;
		return `(property not found: ${[...seen, part].join(".")}). ${hasAt(where, at)}`;
	}
	return root === undefined ? `(no ${label})` : showValue(undefined);
}

function hasAt(where: string, at: unknown) {
	if (Array.isArray(at)) return `${where} is a list of ${at.length} items`;
	if (!isObject(at)) return `${where} is ${showValue(at)}`;
	const keys = Object.keys(at);
	if (keys.length === 0) return `${where} has no properties`;
	const more = keys.length > MAX_KEYS ? ", …" : "";
	return `${where} has: ${keys.slice(0, MAX_KEYS).join(", ")}${more}`;
}

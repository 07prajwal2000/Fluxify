import type { CanvasIssue } from "./rules";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Keys in `raw` that `parsed` (the schema's output) no longer has, as `a.b[0].c` paths. */
export function droppedKeys(raw: unknown, parsed: unknown, path = ""): string[] {
	if (isPlainObject(raw) && isPlainObject(parsed))
		return Object.keys(raw).flatMap((k) =>
			k in parsed
				? droppedKeys(raw[k], parsed[k], path ? `${path}.${k}` : k)
				: [path ? `${path}.${k}` : k],
		);
	if (Array.isArray(raw) && Array.isArray(parsed) && raw.length === parsed.length)
		return raw.flatMap((v, i) => droppedKeys(v, parsed[i], `${path}[${i}]`));
	return [];
}

/**
 * The validator runs as middleware, the save in the handler. They share the
 * validated body object, so the warnings ride on it instead of through every
 * route handler.
 */
const warnings = new WeakMap<object, CanvasIssue[]>();

export const rememberDroppedWarnings = (body: object, issues: CanvasIssue[]) =>
	issues.length && warnings.set(body, issues);

export const takeDroppedWarnings = (body: object): CanvasIssue[] => warnings.get(body) ?? [];

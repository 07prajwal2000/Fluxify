import { z } from "zod";

/**
 * One place that turns a validation failure into text an agent can act on
 * (#779). Every save_* tool goes through it, so a rejected input always names
 * the field path and the reason, whether the failure is a zod issue in the MCP
 * layer or an admin API 400 body.
 */

/** How many issues a message lists before it ends with "and K more". */
export const MAX_ISSUES = 5;

type Issue = { path?: readonly PropertyKey[]; message: string };
type ApiFieldError = { field?: string; message?: string };

/**
 * A field path as an agent reads it: `graph.blocks[3].type`, `values[0].key`,
 * `keyName`. An empty path (a root-level issue) is `(root)`.
 */
export function formatPath(path: readonly PropertyKey[] = []): string {
	if (!path.length) return "(root)";
	let out = "";
	for (const [i, segment] of path.entries()) {
		const key = String(segment);
		// a numeric key (an array index) or the same from the API's dotted field
		if (typeof segment === "number" || /^\d+$/.test(key)) out += `[${key}]`;
		else out += i === 0 ? key : `.${key}`;
	}
	return out;
}

/**
 * `keyName: Required; values[0].key: Expected string, received number`, capped
 * at MAX_ISSUES with `; and K more`.
 */
export function formatIssues(issues: Issue[]): string {
	const shown = issues.slice(0, MAX_ISSUES).map((i) => `${formatPath(i.path)}: ${i.message}`);
	const more = issues.length - shown.length;
	return shown.join("; ") + (more > 0 ? `; and ${more} more` : "");
}

/** The admin API joins a zod path with "."; a numeric segment is an array index. */
export function formatFieldPath(field: string): string {
	return field ? formatPath(field.split(".")) : "(root)";
}

/**
 * Formats a thrown value that carries zod issues or an admin API `errors` list
 * (each `{ field, message }`). Anything else returns undefined, so the caller
 * keeps the error's own message.
 */
export function formatToolError(err: unknown): string | undefined {
	if (err instanceof z.ZodError) return formatIssues(err.issues);
	const errors = (err as { errors?: ApiFieldError[] } | null)?.errors;
	if (Array.isArray(errors) && errors.length)
		return formatIssues(
			errors.map((e) => ({
				path: e.field ? e.field.split(".") : [],
				message: e.message ?? "Invalid input",
			})),
		);
	return undefined;
}

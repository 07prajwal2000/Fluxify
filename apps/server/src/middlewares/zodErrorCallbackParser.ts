import type { Context } from "hono";
import type z from "zod";
import type { validationErrorSchema } from "../errors/validationError";

/**
 * The hook a validation middleware calls on failure. Two callers feed it:
 * hono-openapi's validator hands the issues array as `error`, and
 * @hono/zod-validator hands a ZodError whose `issues` array is the same list.
 * Either way each issue gets its full path ("changes.blocks.3.data"; empty for
 * a root-level issue) and message, so a 400 always names the field (#779).
 */
export default function (result: any, ctx: Context) {
	if (result?.success) return;
	const raw = result?.error;
	const issues = (Array.isArray(raw) ? raw : (raw?.issues ?? [])) as {
		path?: PropertyKey[];
		message?: string;
	}[];
	const body: z.infer<typeof validationErrorSchema> = {
		type: "validation",
		errors: issues.map((issue) => ({
			field: (issue.path ?? []).map((segment) => String(segment)).join("."),
			message: issue.message ?? "Invalid input",
		})),
	};
	return ctx.json(body, 400);
}

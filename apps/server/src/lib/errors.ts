import type { ZodError } from "zod";

/** one entry per issue; an issue about the whole value (no path) has an empty field */
export function mapZodErrorToFieldErrors(error: ZodError) {
	return error.issues.map((issue) => ({
		field: issue.path[0]?.toString() ?? "",
		message: issue.message,
	}));
}

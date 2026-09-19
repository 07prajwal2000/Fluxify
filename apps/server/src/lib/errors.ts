import type { ZodError } from "zod";

export function mapZodErrorToFieldErrors(error: ZodError) {
	return error.issues.map((issue) => ({
		field: issue.path[0].toString(),
		message: issue.message,
	}));
}

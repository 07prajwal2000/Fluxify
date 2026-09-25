import { toast } from "@fluxify/components";
import { isAxiosError } from "axios";
import { httpcodes } from "./httpcode";

export type FieldError = { field?: string; message: string };
export type ParsedApiError = { status?: number; message: string; fieldErrors?: FieldError[] };

const UNKNOWN = "Unknown error occurred";

/**
 * Reads any failed request into one shape. Handles the server's validation body
 * (`errors`, legacy `error`), a `message` body, a proxy's HTML/text body (falls
 * back to the status name) and no response at all. Never throws.
 */
export function parseApiError(error: unknown): ParsedApiError {
	if (!isAxiosError(error)) {
		return { message: (error as Error | undefined)?.message || UNKNOWN };
	}
	if (!error.response) return { message: "Network error, check your connection" };

	const { status, data } = error.response;
	const list = data?.errors ?? data?.error;
	const fieldErrors = Array.isArray(list)
		? list
				.filter((e) => typeof e?.message === "string")
				.map((e) => ({ field: e.field || undefined, message: e.message as string }))
		: undefined;
	const statusText = httpcodes.find((c) => c.code === String(status))?.name;
	const message =
		(typeof data?.message === "string" && data.message) ||
		fieldErrors?.[0]?.message ||
		(statusText ? `${status} ${statusText}` : UNKNOWN);
	return { status, message, fieldErrors: fieldErrors?.length ? fieldErrors : undefined };
}

export const formatFieldError = (e: FieldError) =>
	e.field ? `${e.message} (field: ${e.field})` : e.message;

export function showErrorNotification(error?: unknown, showValidationErrors = true) {
	const { message, fieldErrors } = parseApiError(error);
	if (!fieldErrors) return void toast.danger(message);
	if (!showValidationErrors)
		return void toast.danger("Validation Error. Please provide valid data.");
	for (const err of fieldErrors) toast.danger(formatFieldError(err));
}

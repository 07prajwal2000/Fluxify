/**
 * A suite stores its body as JSON, so files travel as base64. The route must see
 * what a real request gives it (see `requestRouter/requestBody.ts`): a `File` for
 * a multipart file, a `Blob` for an octet-stream body.
 *
 * One stored body in, one request body out, so data-driven cases (#486) can
 * decode each case the same way.
 */

export type StoredFile = { name: string; type: string; base64: string };

export function isStoredFile(value: unknown): value is StoredFile {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as StoredFile).name === "string" &&
		typeof (value as StoredFile).base64 === "string"
	);
}

const bytes = (base64: string) => Buffer.from(base64, "base64");

function toFile(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(toFile);
	return isStoredFile(value)
		? new File([bytes(value.base64)], value.name, { type: value.type || "" })
		: value;
}

export function decodeSuiteBody(body: unknown, contentType: string): unknown {
	if (contentType === "application/octet-stream") {
		return typeof body === "string" ? new Blob([bytes(body)], { type: contentType }) : body;
	}
	if (contentType === "multipart/form-data" && body && typeof body === "object") {
		return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, toFile(value)]));
	}
	return body;
}

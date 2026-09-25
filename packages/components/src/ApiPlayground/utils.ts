import type {
	ApiFormRow,
	ApiFormValue,
	ApiKeyValue,
	ApiRequestBody,
	ApiSchema,
	ApiSchemaProperty,
} from "./types";

export const createRow = (key = "", value = "", required = false): ApiKeyValue => ({
	id: crypto.randomUUID(),
	key,
	value,
	required,
});

export function schemaProperties(schema?: ApiSchema | null): ApiSchemaProperty[] {
	if (!schema?.properties) return [];
	if (Array.isArray(schema.properties)) return schema.properties;
	const required = "required" in schema && Array.isArray(schema.required) ? schema.required : [];
	return Object.entries(schema.properties).map(([key, property]) => ({
		key,
		dataType: ("dataType" in property ? property.dataType : undefined) ?? property.type,
		required: property.required ?? required.includes(key),
		rules: "rules" in property ? property.rules : undefined,
	}));
}

export function pathParameterNames(path: string) {
	return Array.from(path.matchAll(/:([A-Za-z0-9_]+)/g), ([, name]) => name);
}

export function inferLanguage(mimeType?: string) {
	const mime = mimeType?.split(";", 1)[0]?.toLowerCase() ?? "";
	if (mime.includes("json") || mime.endsWith("+json")) return "json";
	if (mime.includes("xml")) return "xml";
	if (mime.includes("html")) return "html";
	if (mime.includes("javascript")) return "javascript";
	if (mime.startsWith("text/")) return "plaintext";
	return "plaintext";
}

/** Pretty-print valid JSON responses while preserving non-JSON and invalid JSON bodies. */
export function formatResponseBody(body: string, mimeType?: string) {
	const mime = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
	if (mime !== "application/json") return body;

	try {
		return JSON.stringify(JSON.parse(body), null, 2);
	} catch {
		return body;
	}
}

export function responseHeaders(headers?: Headers | Record<string, string>) {
	if (!headers) return [] as [string, string][];
	if (headers instanceof Headers) return Array.from(headers.entries());
	return Object.entries(headers);
}

export function statusTone(status: number) {
	if (status < 200) return "border-sky-500/30 bg-sky-500/10 text-sky-400";
	if (status < 300) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
	if (status < 400) return "border-violet-500/30 bg-violet-500/10 text-violet-400";
	if (status < 500) return "border-amber-500/30 bg-amber-500/10 text-amber-400";
	return "border-rose-500/30 bg-rose-500/10 text-rose-400";
}

/** Rows may repeat a key; the server turns a repeated key back into an array. */
export function serializeFormBody(
	body: Record<string, ApiFormValue> | ApiFormRow[],
	contentType?: string,
) {
	const entries: [string, string | File][] = (
		Array.isArray(body)
			? body.filter((row) => row.key).map((row): [string, string | File] => [row.key, row.value])
			: Object.entries(body).flatMap(([key, value]) =>
					(Array.isArray(value) ? value : [value]).map((part): [string, string | File] => [
						key,
						part,
					]),
				)
	).filter(([, value]) => value !== "");
	if (contentType === "multipart/form-data") {
		const form = new FormData();
		for (const [key, value] of entries) form.append(key, value);
		return form;
	}
	return new URLSearchParams(
		entries.filter((entry): entry is [string, string] => typeof entry[1] === "string"),
	).toString();
}

/** Methods the server reads a body for. */
export const methodTakesBody = (method: string) => ["POST", "PUT"].includes(method.toUpperCase());

export const isFormContentType = (contentType: string) =>
	contentType === "application/x-www-form-urlencoded" || contentType === "multipart/form-data";

/** null when the text is not base64 */
export function base64ToBlob(text: string): Blob | null {
	try {
		const binary = atob(text.replace(/\s/g, ""));
		return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], {
			type: "application/octet-stream",
		});
	} catch {
		return null;
	}
}

export const emptyRequestBody = (raw = ""): ApiRequestBody => ({
	raw,
	form: {},
	formRows: [],
	binary: "",
});

/** The payload for the current content type, or undefined for an empty one. */
export function serializeRequestBody(
	body: ApiRequestBody,
	contentType: string,
	schema?: ApiSchema | null,
): string | FormData | Blob | undefined {
	if (isFormContentType(contentType)) {
		return serializeFormBody(
			schemaProperties(schema).length > 0 ? body.form : body.formRows,
			contentType,
		);
	}
	if (contentType === "application/octet-stream") {
		if (body.binary instanceof File) return body.binary;
		// sent as typed when it isn't base64, so a bad body still reaches the server
		return body.binary ? (base64ToBlob(body.binary) ?? body.binary) : undefined;
	}
	return body.raw;
}

export function resolvePathRows(
	path: string,
	initialPathParams?: Record<string, string>,
	cachedRows?: ApiKeyValue[],
): ApiKeyValue[] {
	if (cachedRows && cachedRows.length > 0) {
		const existingMap = new Map(cachedRows.map((row) => [row.key, row]));
		return pathParameterNames(path).map(
			(key) => existingMap.get(key) ?? createRow(key, initialPathParams?.[key] ?? "", true),
		);
	}
	return pathParameterNames(path).map((key) =>
		createRow(key, initialPathParams?.[key] ?? "", true),
	);
}

export function resolveQueryRows(
	querySchema: ApiSchema | null | undefined,
	initialQuery?: Record<string, string>,
	cachedRows?: ApiKeyValue[],
): ApiKeyValue[] {
	if (cachedRows) {
		const existingMap = new Map(cachedRows.map((row) => [row.key, row]));
		const schemaProps = schemaProperties(querySchema);
		const fromSchema = schemaProps.map(
			(field) =>
				existingMap.get(field.key) ??
				createRow(field.key, initialQuery?.[field.key] ?? "", field.required),
		);
		const schemaKeys = new Set(schemaProps.map((p) => p.key));
		const customRows = cachedRows.filter((row) => !schemaKeys.has(row.key));
		return [...fromSchema, ...customRows];
	}
	return schemaProperties(querySchema).map((field) =>
		createRow(field.key, initialQuery?.[field.key] ?? "", field.required),
	);
}

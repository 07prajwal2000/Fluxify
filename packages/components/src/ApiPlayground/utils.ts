import type { ApiFormValue, ApiKeyValue, ApiSchema, ApiSchemaProperty } from "./types";

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
		dataType: property.type,
		required: property.required ?? required.includes(key),
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

export function serializeFormBody(body: Record<string, ApiFormValue>, contentType?: string) {
	if (contentType === "multipart/form-data") {
		const form = new FormData();
		for (const [key, value] of Object.entries(body)) if (value !== "") form.append(key, value);
		return form;
	}
	return new URLSearchParams(Object.entries(body).filter(([, value]) => typeof value === "string") as [string, string][]).toString();
}

import { type ApiFormRow, type ApiRequestBody, emptyRequestBody } from "@fluxify/components";

/**
 * A suite body is stored as JSON (see the server's testSuiteCoreSchema): files
 * travel as { name, type, base64 }, an octet-stream body as base64 text. The
 * editor works on real Files, so a body is decoded on open and encoded on edit.
 * JSON stays parsed JSON, so data-driven cases (#486) can merge over it.
 */

type StoredFile = { name: string; type: string; base64: string };

/** matches the server cap: ~1MB of file */
export const MAX_FILE_BYTES = 1024 * 1024;

const isStoredFile = (value: unknown): value is StoredFile =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as StoredFile).name === "string" &&
	typeof (value as StoredFile).base64 === "string";

function toFile({ name, type, base64 }: StoredFile): File {
	return new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], name, { type });
}

async function toBase64(file: File): Promise<string> {
	if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is over 1MB`);
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	// chunked: spreading a whole file into fromCharCode overflows the stack
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

const isForm = (contentType: string) =>
	contentType === "multipart/form-data" || contentType === "application/x-www-form-urlencoded";

export function toEditorBody(stored: unknown, contentType: string): ApiRequestBody {
	const body = emptyRequestBody();
	if (isForm(contentType)) {
		if (stored && typeof stored === "object" && !Array.isArray(stored)) {
			for (const [key, value] of Object.entries(stored)) {
				const parts = (Array.isArray(value) ? value : [value]).map((part) =>
					isStoredFile(part) ? toFile(part) : String(part ?? ""),
				);
				const files = parts.filter((part): part is File => part instanceof File);
				body.form[key] = Array.isArray(value) && files.length > 0 ? files : (parts[0] ?? "");
				for (const part of parts) {
					body.formRows.push({
						id: crypto.randomUUID(),
						key,
						value: part,
						isFile: part instanceof File,
					});
				}
			}
		}
	} else if (contentType === "application/octet-stream") {
		body.binary = typeof stored === "string" ? stored : "";
	} else if (contentType.includes("json")) {
		body.raw = stored === null || stored === undefined ? "{}" : JSON.stringify(stored, null, 2);
	} else {
		body.raw = typeof stored === "string" ? stored : "";
	}
	return body;
}

/** Repeated keys become an array, the way the server reads a multipart body. */
function rowsToRecord(rows: ApiFormRow[]) {
	const record: Record<string, string | File | (string | File)[]> = {};
	for (const { key, value } of rows) {
		if (!key || value === "") continue;
		const existing = record[key];
		record[key] =
			existing === undefined
				? value
				: Array.isArray(existing)
					? [...existing, value]
					: [existing, value];
	}
	return record;
}

async function encodeValue(value: unknown): Promise<unknown> {
	if (Array.isArray(value)) return Promise.all(value.map(encodeValue));
	if (value instanceof File) {
		return { name: value.name, type: value.type, base64: await toBase64(value) };
	}
	return value;
}

/** The stored body, or an error the editor shows instead of saving. */
export async function fromEditorBody(
	body: ApiRequestBody,
	contentType: string,
	hasSchemaFields: boolean,
): Promise<{ body: unknown } | { error: string }> {
	try {
		if (isForm(contentType)) {
			const source = hasSchemaFields ? body.form : rowsToRecord(body.formRows);
			const entries = Object.entries(source).filter(([, value]) => value !== "");
			return {
				body: Object.fromEntries(
					await Promise.all(entries.map(async ([key, value]) => [key, await encodeValue(value)])),
				),
			};
		}
		if (contentType === "application/octet-stream") {
			return {
				body: body.binary instanceof File ? await toBase64(body.binary) : body.binary || null,
			};
		}
		if (contentType.includes("json")) {
			return { body: body.raw.trim() ? JSON.parse(body.raw) : null };
		}
		return { body: body.raw };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: error instanceof SyntaxError ? `Invalid JSON: ${message}` : message };
	}
}

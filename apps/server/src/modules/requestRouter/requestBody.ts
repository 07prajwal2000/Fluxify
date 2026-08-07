import {
	CONTENT_TYPES,
	type ContentType,
} from "../../lib/routeConfig";

/**
 * Reads the body of an incoming HTTP request in the format the route declared.
 *
 * Nothing is read until the route has matched: the accepted content types are
 * per-route, so the parse is deliberately deferred (see `BodyReader.parse`).
 * Only the transport knows about content types — every consumer downstream
 * (the get-request-body block, the JS runner global, body schema validation)
 * sees the same plain value.
 */

export type BodyErrorStatus = 400 | 413 | 415;

export class RequestBodyError extends Error {
	constructor(
		readonly status: BodyErrorStatus,
		message: string,
	) {
		super(message);
		this.name = "RequestBodyError";
	}
}

/** Methods that carry a body. DELETE may per RFC 9110, but we don't invite it. */
const METHODS_WITH_BODY = new Set(["POST", "PUT"]);

/** `application/json; charset=utf-8` -> `application/json` */
export function mediaType(header?: string | null): string {
	return (header ?? "").split(";")[0]!.trim().toLowerCase();
}

function isSupported(type: string): type is ContentType {
	return (CONTENT_TYPES as readonly string[]).includes(type);
}

/**
 * Repeated keys become an array — dropping the second file of a two-file upload
 * is worse than the shape being uneven. `defineProperty` so a `__proto__` field
 * lands as an own property instead of reaching the prototype setter.
 */
function entriesToObject(entries: Iterable<[string, unknown]>) {
	const out: Record<string, unknown> = {};
	for (const [key, value] of entries) {
		const existing = Object.hasOwn(out, key) ? out[key] : undefined;
		const next =
			existing === undefined
				? value
				: Array.isArray(existing)
					? [...existing, value]
					: [existing, value];
		Object.defineProperty(out, key, {
			value: next,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return out;
}

async function decode(
	contentType: ContentType,
	bytes: ArrayBuffer,
	rawHeader: string,
): Promise<unknown> {
	switch (contentType) {
		case "application/json": {
			const text = new TextDecoder().decode(bytes);
			return text.trim() === "" ? null : JSON.parse(text);
		}
		case "text/plain":
			return new TextDecoder().decode(bytes);
		case "application/x-www-form-urlencoded":
			return entriesToObject(
				new URLSearchParams(new TextDecoder().decode(bytes)),
			);
		case "multipart/form-data":
			// the raw header carries the boundary, so hand it back verbatim
			return entriesToObject(
				await new Response(bytes, {
					headers: { "content-type": rawHeader },
				}).formData(),
			);
		case "application/octet-stream":
			return new Blob([bytes], { type: contentType });
	}
}

/** the slice of a Hono (or Hono-like) context this module needs */
type RequestLike = {
	method: string;
	header(name: string): string | undefined;
	raw: Request;
};

export type BodyReader = {
	/**
	 * Buffer the bytes now. Async-reply requests answer 202 before the route
	 * runs, and the request stream is not guaranteed to outlive that response.
	 */
	materialize(): Promise<void>;
	/** Parse into a plain value, or throw `RequestBodyError`. */
	parse(accepted: readonly string[]): Promise<unknown>;
};

/**
 * Returns undefined when the request declares no body — a bodyless POST stays
 * `null`, as it was before content types were enforced.
 */
export function bodyReader(
	req: RequestLike,
	maxBytes: number,
): BodyReader | undefined {
	if (!METHODS_WITH_BODY.has(req.method.toUpperCase())) return;
	const rawHeader = req.header("content-type");
	const contentType = mediaType(rawHeader);
	if (!contentType) return;

	const declared = Number(req.header("content-length"));
	let bytes: Promise<ArrayBuffer> | undefined;
	const read = () => (bytes ??= req.raw.arrayBuffer());

	return {
		async materialize() {
			if (Number.isFinite(declared) && declared > maxBytes) return;
			await read().catch(() => undefined);
		},
		async parse(accepted: readonly string[]) {
			if (!isSupported(contentType) || !accepted.includes(contentType)) {
				throw new RequestBodyError(
					415,
					`Unsupported content type "${contentType}". This route accepts: ${accepted.join(", ")}`,
				);
			}
			if (Number.isFinite(declared) && declared > maxBytes) {
				throw new RequestBodyError(413, tooLarge(maxBytes));
			}
			let buffer: ArrayBuffer;
			try {
				buffer = await read();
			} catch {
				// Bun rejects the read once its own body limit is exceeded
				throw new RequestBodyError(413, tooLarge(maxBytes));
			}
			if (buffer.byteLength > maxBytes) {
				throw new RequestBodyError(413, tooLarge(maxBytes));
			}
			try {
				return await decode(contentType, buffer, rawHeader!);
			} catch (error) {
				throw new RequestBodyError(
					400,
					`Malformed ${contentType} body: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
	};
}

function tooLarge(maxBytes: number) {
	return `Request body exceeds the ${Math.floor(maxBytes / 1024)}KB limit`;
}

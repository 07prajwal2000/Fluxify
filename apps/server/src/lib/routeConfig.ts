import z from "zod";

/**
 * Per-route settings stored in `http_route_config.route_config`. One open jsonb
 * bag so the next knob is a change here, not a migration. Everything in it must
 * have a default: most routes have no row at all.
 */

/** Body formats a route may accept. Anything else is rejected with a 415. */
export const CONTENT_TYPES = [
	"application/json",
	"application/x-www-form-urlencoded",
	"multipart/form-data",
	"application/octet-stream",
	"text/plain",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const DEFAULT_CONTENT_TYPES: ContentType[] = ["application/json"];

/**
 * How an accepted octet-stream body is handed to user code: buffered into a
 * `Blob`, or exposed as the live `ReadableStream<Uint8Array>`.
 */
export const BODY_MODES = ["buffer", "stream"] as const;
export type BodyMode = (typeof BODY_MODES)[number];
export const DEFAULT_BODY_MODE: BodyMode = "buffer";

/** Streaming only makes sense when raw bytes are the only thing a route accepts. */
export function isStreamContentTypes(accepted: readonly string[]): boolean {
	return accepted.length === 1 && accepted[0] === "application/octet-stream";
}

export const routeConfigSchema = z.object({
	acceptedContentTypes: z
		.array(z.enum(CONTENT_TYPES))
		.min(1)
		.default(() => [...DEFAULT_CONTENT_TYPES]),
	bodyMode: z.enum(BODY_MODES).default(DEFAULT_BODY_MODE),
});

export type RouteConfig = z.infer<typeof routeConfigSchema>;

/**
 * The write-side rule: a pipe-stream route accepts exactly one raw media type.
 * Read-side parsing is more forgiving — see `parseRouteConfig`.
 */
export function streamBodyConfigError(
	accepted: readonly string[],
	bodyMode: BodyMode,
): string | undefined {
	if (bodyMode !== "stream") return;
	return isStreamContentTypes(accepted)
		? undefined
		: "Pipe-stream mode requires application/octet-stream as the only accepted content type";
}

/**
 * Stored config is data, not input: a row written by an older build must not
 * take the route down. Anything unparseable falls back to the defaults.
 */
export function parseRouteConfig(stored: unknown): RouteConfig {
	const parsed = routeConfigSchema.safeParse(stored ?? {});
	if (!parsed.success) {
		return { acceptedContentTypes: [...DEFAULT_CONTENT_TYPES], bodyMode: DEFAULT_BODY_MODE };
	}
	// Stored config is data, not input. A row (or an older build) that pairs
	// stream mode with JSON is read as buffered rather than handing user code a
	// stream whose content type the route never promised.
	return parsed.data.bodyMode === "stream" &&
		!isStreamContentTypes(parsed.data.acceptedContentTypes)
		? { ...parsed.data, bodyMode: DEFAULT_BODY_MODE }
		: parsed.data;
}

export function acceptedContentTypes(stored: unknown): ContentType[] {
	return parseRouteConfig(stored).acceptedContentTypes;
}

export function bodyModeOf(stored: unknown): BodyMode {
	return parseRouteConfig(stored).bodyMode;
}

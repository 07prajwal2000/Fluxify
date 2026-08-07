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

export const routeConfigSchema = z.object({
	acceptedContentTypes: z
		.array(z.enum(CONTENT_TYPES))
		.min(1)
		.default(() => [...DEFAULT_CONTENT_TYPES]),
});

export type RouteConfig = z.infer<typeof routeConfigSchema>;

/**
 * Stored config is data, not input: a row written by an older build must not
 * take the route down. Anything unparseable falls back to the defaults.
 */
export function parseRouteConfig(stored: unknown): RouteConfig {
	const parsed = routeConfigSchema.safeParse(stored ?? {});
	return parsed.success
		? parsed.data
		: { acceptedContentTypes: [...DEFAULT_CONTENT_TYPES] };
}

export function acceptedContentTypes(stored: unknown): ContentType[] {
	return parseRouteConfig(stored).acceptedContentTypes;
}

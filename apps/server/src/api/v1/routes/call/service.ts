import { z } from "zod";
import type { AuthACL } from "../../../../db/schema";
import { BadRequestError } from "../../../../errors/badRequestError";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { canAccessProject } from "../../../../lib/acl";
import { getEnv } from "../../../../lib/env";
import { getRouteById } from "../get-by-id/repository";
import { specServerUrl } from "../openapi/service";

export const callBodySchema = z.object({
	params: z.record(z.string(), z.string()).optional(),
	query: z.record(z.string(), z.string()).optional(),
	headers: z.record(z.string(), z.string()).optional(),
	body: z.unknown().optional(),
});

export const callResultSchema = z.object({
	status: z.number().int().nullable(),
	contentType: z.string().nullable(),
	body: z.unknown(),
	error: z.string().optional(),
});

/** Fills `:name` segments from `params`; a missing one is the caller's mistake. */
export function fillPath(path: string, params: Record<string, string> = {}) {
	return path.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => {
		if (params[name] === undefined) throw new BadRequestError(`Missing path param "${name}"`);
		return encodeURIComponent(params[name]);
	});
}

/**
 * `*.localhost` is always loopback (RFC 6761), but the server's OS resolver may
 * not know that (Windows). Dial 127.0.0.1 instead and keep the name in `Host`,
 * which is what picks the project.
 */
export function fetchRoute(url: URL, init: RequestInit) {
	const { hostname } = url;
	if (hostname !== "localhost" && !hostname.endsWith(".localhost")) return fetch(url, init);
	const headers = new Headers(init.headers);
	headers.set("host", url.host);
	const target = new URL(url);
	target.hostname = "127.0.0.1";
	return fetch(target, { ...init, headers });
}

/**
 * Sends one real request to a route, the way the portal's playground does:
 * over HTTP to the project's public URL, so it runs on whatever serves the
 * project's traffic. Creator only, because it runs user code that may write data.
 */
export async function callRoute(
	id: string,
	input: z.infer<typeof callBodySchema>,
	acl: AuthACL[],
	requestOrigin: string,
): Promise<z.infer<typeof callResultSchema>> {
	const route = await getRouteById(id);
	if (!route) throw new NotFoundError("Route not found");
	if (!canAccessProject(acl, route.projectId ?? "", "creator")) throw new ForbiddenError();
	if (!route.active) throw new BadRequestError("Route is not active — activate it to call it");

	const base = specServerUrl(route.projectId!, getEnv("SERVER_URL") || requestOrigin);
	const url = new URL(fillPath(route.path!, input.params), base);
	for (const [k, v] of Object.entries(input.query ?? {})) url.searchParams.set(k, v);

	const headers = new Headers(input.headers);
	let body: string | undefined;
	if (input.body !== undefined && route.method !== "GET") {
		body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
		if (!headers.has("content-type") && typeof input.body !== "string")
			headers.set("content-type", "application/json");
	}

	try {
		const res = await fetchRoute(url, {
			method: route.method!,
			headers,
			body,
			redirect: "manual",
			signal: AbortSignal.timeout((route.timeoutSeconds + 5) * 1000),
		});
		const contentType = res.headers.get("content-type");
		const text = await res.text();
		let parsed: unknown = text;
		if (contentType?.includes("json")) {
			try {
				parsed = JSON.parse(text);
			} catch {}
		}
		return { status: res.status, contentType, body: parsed };
	} catch (error) {
		return {
			status: null,
			contentType: null,
			body: null,
			error: `Could not reach ${url.origin}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

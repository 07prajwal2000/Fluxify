import type { ApiPlaygroundRequest, ApiPlaygroundResponse } from "@fluxify/components";

/** The header the development worker checks before it answers a sandbox call. */
export const DEV_TOKEN_HEADER = "x-fluxify-dev-token";

/** Under the development URL: the token chooses the project, and a subdomain, when set, is the only host (#742). */
export const DEV_URL_NOTE =
	"Sent to the development worker, which picks the project from the development token. A project with a subdomain answers on that subdomain only.";

/** A route's development address: the real route path goes after it. */
export const DEV_ROUTE_PREFIX = "/_/dev";

/** Under the production URL in the playground (#739): the real thing, no token. */
export const PROD_URL_NOTE =
	"Sent straight to your route's public address, the same one your callers use. It runs the version in production, with production values.";

/** What the playground confirms before the first production call in a session (#739). */
export const PROD_CONFIRM = "This calls production: real data, real side effects.";

/** Shown wherever a sandbox cannot run because no development worker is up. */
export const DEV_WORKER_MESSAGE =
	"No development worker is running. Start a worker with FLUXIFY_ENV=development to try routes and sandboxes.";

/** A sandbox answers on `/_sandbox/<id>`, whatever comes after it. */
export function sandboxBaseUrl(baseUrl: string, sandboxId: string) {
	return `${baseUrl.replace(/\/+$/, "")}/_sandbox/${sandboxId}`;
}

/**
 * Sends one playground request straight to the development worker, with the
 * project's development token. The token only ever goes into this header; it is
 * not part of the request the playground shows.
 */
export async function sendSandboxRequest(
	request: ApiPlaygroundRequest,
	token: string,
): Promise<ApiPlaygroundResponse> {
	const headers = new Headers(request.headers);
	// The browser supplies multipart boundaries; a manually-set value would break them.
	if (request.body instanceof FormData) headers.delete("content-type");
	headers.set(DEV_TOKEN_HEADER, token);
	return sendWith(request, headers, "the development worker");
}

/**
 * Sends one playground request to the route's real production address (#739),
 * with no development token and no rewriting: it is what a caller would send.
 */
export async function sendProductionRequest(
	request: ApiPlaygroundRequest,
): Promise<ApiPlaygroundResponse> {
	const headers = new Headers(request.headers);
	if (request.body instanceof FormData) headers.delete("content-type");
	return sendWith(request, headers, "your route");
}

async function sendWith(
	request: ApiPlaygroundRequest,
	headers: Headers,
	unreachable: string,
): Promise<ApiPlaygroundResponse> {
	const startedAt = performance.now();
	try {
		const response = await fetch(request.url, {
			method: request.method,
			headers,
			body: request.body,
		});
		const body = await response.text();
		return {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
			body,
			mimeType: response.headers.get("content-type") ?? undefined,
			durationMs: Math.round(performance.now() - startedAt),
			bytes: new TextEncoder().encode(body).byteLength,
		};
	} catch (error) {
		// nothing answered: a worker that is down, or a browser block (CORS) on a wrong address
		const reason = (error as Error | undefined)?.message ?? "";
		const body = `Could not reach ${unreachable} at ${new URL(request.url).origin}. ${reason}`;
		return { status: 0, statusText: "No response", body: body.trim(), mimeType: "text/plain" };
	}
}

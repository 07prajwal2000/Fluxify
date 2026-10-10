import type { ApiPlaygroundRequest, ApiPlaygroundResponse } from "@fluxify/components";

/** The header the development worker checks before it answers a sandbox call. */
export const DEV_TOKEN_HEADER = "x-fluxify-dev-token";

/** Shown wherever a sandbox cannot run because no development worker is up. */
export const DEV_WORKER_MESSAGE =
	"No development worker is running. Start a worker with FLUXIFY_ENV=development to run a sandbox.";

/** A sandbox answers on `/_sandbox/<id>`, whatever comes after it. */
export function sandboxBaseUrl(devWorkerUrl: string, sandboxId: string) {
	return `${devWorkerUrl.replace(/\/+$/, "")}/_sandbox/${sandboxId}`;
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
	const startedAt = performance.now();
	const headers = new Headers(request.headers);
	// The browser supplies multipart boundaries; a manually-set value would break them.
	if (request.body instanceof FormData) headers.delete("content-type");
	headers.set(DEV_TOKEN_HEADER, token);
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
		const body = `Could not reach the development worker at ${new URL(request.url).origin}. ${reason}`;
		return { status: 0, statusText: "No response", body: body.trim(), mimeType: "text/plain" };
	}
}

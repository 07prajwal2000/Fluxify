/**
 * The rules `sse.send` / `close` / `signal` follow (#1023), shared by the
 * worker's runtime and `runBlock`'s fake so the two cannot drift.
 */

export const BAD_HANDLE = "not an SSE connection handle";

/** `<integrationId>:<id>`, split on the first `:` only, so an id may hold colons */
export function parseHandle(handle: unknown) {
	const at = typeof handle === "string" ? handle.indexOf(":") : -1;
	if (at < 1 || at === (handle as string).length - 1) throw new Error(BAD_HANDLE);
	return { integrationId: (handle as string).slice(0, at), id: (handle as string).slice(at + 1) };
}

/** what the client receives: strings as-is, anything else as JSON */
export const sseData = (data: unknown) =>
	typeof data === "string" ? data : (JSON.stringify(data) ?? "");

/**
 * A Hono-shaped view over a native Request.
 *
 * The execution thread serves with Bun.serve directly — Hono's router is dead
 * weight when HttpRouteParser already does the matching. But dispatch() and the
 * block context read the request through a handful of Hono accessors, and
 * hono/cookie's helpers are pure functions over `req.raw.headers` and
 * `header()`. Implementing that surface keeps the request path byte-identical
 * between the Hono worker and this one, instead of forking it.
 */
export type HonoLikeContext = ReturnType<typeof createHttpContext>;

export function createHttpContext(request: Request) {
	const url = new URL(request.url);
	const responseHeaders = new Headers();

	return {
		/** collected via header() — Set-Cookie included, appended not replaced */
		responseHeaders,
		req: {
			raw: request,
			method: request.method,
			path: url.pathname,
			/** no argument returns every header, matching Hono */
			header(name?: string) {
				if (name === undefined) {
					return Object.fromEntries(request.headers.entries());
				}
				return request.headers.get(name) ?? undefined;
			},
			query(name?: string) {
				if (name === undefined) {
					return Object.fromEntries(url.searchParams.entries());
				}
				return url.searchParams.get(name) ?? undefined;
			},
			json: () => request.json(),
			text: () => request.text(),
			formData: () => request.formData(),
		},
		header(name: string, value: string, options?: { append?: boolean }) {
			// Set-Cookie is the reason append exists: two cookies must not collapse
			if (options?.append) responseHeaders.append(name, value);
			else responseHeaders.set(name, value);
		},
	};
}

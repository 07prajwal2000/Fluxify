import { parse } from "hono/utils/cookie";

type RequestData = {
	method: string;
	path: string;
	headers: Record<string, string>;
	query: Record<string, string | string[]>;
	body: unknown;
	params: Record<string, string>;
};

/**
 * What the route's entrypoint span records (#628): the whole request, headers
 * and body as separate keys so each gets its own cap. No redaction: recordings
 * are a debug tool and auth headers are expected here.
 */
export function requestTraceInput(request: RequestData, url?: string) {
	const header = (name: string) =>
		Object.entries(request.headers).find(([key]) => key.toLowerCase() === name)?.[1];
	const host = header("host") ?? (url ? new URL(url).host : "");
	return {
		method: request.method,
		url: url ?? `http://${host}${request.path}${queryString(request.query)}`,
		path: request.path,
		host,
		query: request.query,
		params: request.params,
		headers: request.headers,
		cookies: parse(header("cookie") ?? ""),
		body: request.body,
	};
}

function queryString(query: RequestData["query"]) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
	}
	const text = search.toString();
	return text ? `?${text}` : "";
}

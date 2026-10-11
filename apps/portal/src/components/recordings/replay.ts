import type { ApiKeyValue, ApiPlaygroundState } from "@fluxify/components";
import { emptyRequestBody } from "@fluxify/components";
import type { RecordedSpan } from "@/services/recordings";
import { entryInput } from "./EntryInputView";

/**
 * What a recorded run can be sent again with (#752): a request for the route
 * and sandbox playgrounds, or the payload of a workflow or sandbox run.
 */
export type Replay =
	| { kind: "request"; method: string; path: string; state: ApiPlaygroundState }
	| { kind: "payload"; payload: unknown };

type Fields = Record<string, unknown>;

/** Headers the transport owns: the browser or the worker sets them for the new request. */
const TRANSPORT_HEADERS = new Set([
	"host",
	"content-length",
	"connection",
	"transfer-encoding",
	"accept-encoding",
]);

const row = (key: string, value: string, required = false): ApiKeyValue => ({
	id: crypto.randomUUID(),
	key,
	value,
	required,
});

/** a name → value record as rows; a repeated query value gets one row per value */
const rows = (fields: unknown, required = false) =>
	Object.entries((fields ?? {}) as Fields).flatMap(([key, value]) =>
		(Array.isArray(value) ? value : [value]).map((item) =>
			row(key, typeof item === "string" ? item : JSON.stringify(item), required),
		),
	);

/** the playground sends JSON or text; any other recorded type is sent as JSON */
function sendableType(contentType: string | undefined) {
	const type = contentType?.split(";")[0]?.trim().toLowerCase();
	return type && (type.includes("json") || type.startsWith("text/")) ? type : "application/json";
}

/** `/_sandbox/<id>/users/1` and `/users/1` are the same request to a sandbox */
const sandboxPath = (path: string) => path.replace(/^\/_sandbox\/[^/]+/, "") || "/";

/**
 * The replay a recorded run offers, from its own entrypoint's input. Nothing
 * for a run whose input was cut to fit the size cap (it would not be the same
 * request) or that was recorded before inputs were kept.
 */
export function replayOf(spans: RecordedSpan[]): Replay | null {
	for (const span of spans) {
		const entry = entryInput(span);
		if (!entry) continue;
		if (span.truncated) return null;
		const { input } = entry;
		if (entry.kind === "trigger") return { kind: "payload", payload: input.input };

		const headers = Object.entries((input.headers ?? {}) as Record<string, string>);
		const contentType = sendableType(
			headers.find(([name]) => name.toLowerCase() === "content-type")?.[1],
		);
		const body = input.body;
		const raw = body == null ? "" : typeof body === "string" ? body : JSON.stringify(body, null, 2);
		return {
			kind: "request",
			method: String(input.method).toUpperCase(),
			path: sandboxPath(String(input.path ?? new URL(String(input.url)).pathname)),
			state: {
				pathRows: rows(input.params, true),
				queryRows: rows(input.query),
				headerRows: [
					row("Content-Type", contentType, true),
					...headers
						.filter(([name]) => !TRANSPORT_HEADERS.has(name.toLowerCase()))
						.filter(([name]) => name.toLowerCase() !== "content-type")
						.map(([name, value]) => row(name, String(value))),
				],
				contentType,
				requestBody: { ...emptyRequestBody(raw), raw },
				// a replay of a request the schema rejects is the point of replaying it
				validateBeforeSend: false,
			},
		};
	}
	return null;
}

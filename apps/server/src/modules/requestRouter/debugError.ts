import { createHmac, timingSafeEqual } from "node:crypto";
import { GRAPH_SOURCE_URL } from "@fluxify/blocks";
import type { HttpRoute, HttpRouteParser } from "@fluxify/lib";
import { errorText } from "../telemetry/routeRecorder";
import type { RequestEnvelope } from "./types";

/**
 * Debug errors for the admin's test calls (#671). A failing route answers with
 * a generic message on purpose; an admin call carries a short-lived signed
 * token, and only then does the worker add the real error in a response header.
 * A public caller cannot sign one, so whatever it sends, it gets the generic answer.
 */
export const DEBUG_TOKEN_HEADER = "x-fluxify-debug";
export const DEBUG_ERROR_HEADER = "x-fluxify-debug-error";
const TOKEN_TTL_MS = 60_000;
const MAX_MESSAGE = 1_000;
const MAX_DETAIL = 2_000;
const MAX_STACK = 1_500;
/** set on a thrown error by the compiled graph: the block that threw */
const BLOCK_KEY = Symbol.for("fluxify.block");

export type DebugError = {
	block?: { id: string; type: string; name?: string };
	message: string;
	/** the underlying cause the generic message hides, e.g. the SQL error */
	detail?: string;
	/** only for errors thrown by the user's own code, and only its frames */
	stack?: string;
};

/** Derived, so the master key itself never reaches the process running user code. */
export function routeDebugKey(masterKey: string | undefined) {
	if (!masterKey) return "";
	return createHmac("sha256", Buffer.from(masterKey, "base64"))
		.update("fluxify-route-debug")
		.digest("hex");
}

const mac = (key: string, payload: string) =>
	createHmac("sha256", key).update(payload).digest("base64url");

/** One route, one minute: a token seen in transit opens nothing else. */
export function signDebugToken(
	key: string,
	route: { projectId: string; id: string },
	now = Date.now(),
) {
	const expires = String(now + TOKEN_TTL_MS);
	return `${expires}.${mac(key, `${expires}:${route.projectId}:${route.id}`)}`;
}

export function verifyDebugToken(
	key: string | undefined,
	token: string | null | undefined,
	route: { projectId?: string; id: string },
	now = Date.now(),
) {
	if (!key || !token || !route.projectId) return false;
	const [expires, signature] = token.split(".");
	const at = Number(expires);
	if (!signature || !Number.isFinite(at) || at < now || at > now + TOKEN_TTL_MS) return false;
	const expected = Buffer.from(mac(key, `${expires}:${route.projectId}:${route.id}`));
	const given = Buffer.from(signature);
	return given.length === expected.length && timingSafeEqual(given, expected);
}

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * The frames of the user's own code, or nothing when the error came from
 * anywhere else (a driver, the server): those frames are server file paths.
 */
function userStack(error: Error) {
	const frames = (error.stack ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("at "));
	const own = (frame: string) => frame.includes(`(${GRAPH_SOURCE_URL}:`);
	// native frames (JSON.parse) have no location; the first located one decides
	const top = frames.find((frame) => own(frame) || /[\\/]/.test(frame));
	if (!top || !own(top)) return;
	// `$block_1`, `$run`: the generated wrapper, not something the user wrote
	const user = frames.filter((frame) => own(frame) && !frame.startsWith("at $"));
	return user.length ? cap(user.join("\n"), MAX_STACK) : undefined;
}

/** What a failed run tells an admin: which block, what it said, and why. */
export function debugError(error: unknown): DebugError {
	const block = (error as { [BLOCK_KEY]?: DebugError["block"] } | null)?.[BLOCK_KEY];
	const cause = (error as { cause?: unknown } | null)?.cause;
	const result: DebugError = {
		message: cap(error instanceof Error ? error.message : String(error), MAX_MESSAGE),
	};
	if (block) result.block = block;
	if (cause !== undefined) result.detail = cap(errorText(cause), MAX_DETAIL);
	const stack = error instanceof Error ? userStack(error) : undefined;
	if (stack) result.stack = stack;
	return result;
}

/** base64url JSON: a header value cannot hold newlines or most of Unicode */
export const encodeDebugError = (error: DebugError) =>
	Buffer.from(JSON.stringify(error)).toString("base64url");

export function decodeDebugError(value: string | null): DebugError | undefined {
	if (!value) return;
	try {
		return JSON.parse(Buffer.from(value, "base64url").toString());
	} catch {
		return;
	}
}

/**
 * Whether this request is an admin debug call: a valid token for the route it
 * matches. The token is removed either way, so the route's code never sees it.
 */
export function debugRequested(
	env: RequestEnvelope,
	parser: Pick<HttpRouteParser, "getRouteId">,
	key: string | undefined,
) {
	const token = env.payload.headers[DEBUG_TOKEN_HEADER];
	if (token === undefined) return false;
	delete env.payload.headers[DEBUG_TOKEN_HEADER];
	const route = parser.getRouteId(env.payload.path, env.payload.method as HttpRoute["method"]);
	return route !== null && verifyDebugToken(key, token, route);
}

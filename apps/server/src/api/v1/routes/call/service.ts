import { z } from "zod";
import type { AuthACL } from "../../../../db/schema";
import { BadRequestError } from "../../../../errors/badRequestError";
import { ConflictError } from "../../../../errors/conflictError";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { canAccessProject } from "../../../../lib/acl";
import { DEV_WORKER_URL, getEnv } from "../../../../lib/env";
import { projectHost } from "../../../../lib/hosting";
import { baseDomain } from "../../../../loaders/instanceSettingsLoader";
import { projectSettingsCache } from "../../../../loaders/projectSettingsLoader";
import { devWorkerOnline } from "../../../../modules/orchestrator/status";
import {
	DEBUG_ERROR_HEADER,
	DEBUG_TOKEN_HEADER,
	decodeDebugError,
	routeDebugKey,
	signDebugToken,
} from "../../../../modules/requestRouter/debugError";
import { DEBUG_TRACE_HEADER, decodeDebugTrace } from "../../../../modules/requestRouter/debugTrace";
import { DEV_TOKEN_HEADER } from "../../../../modules/requestRouter/devToken";
import { readDevToken } from "../../projects/settings/dev-token/service";
import { getRouteById } from "../get-by-id/repository";
import { specServerUrl } from "../openapi/service";

export const callBodySchema = z.object({
	params: z.record(z.string(), z.string()).optional(),
	query: z.record(z.string(), z.string()).optional(),
	headers: z.record(z.string(), z.string()).optional(),
	body: z.unknown().optional(),
	debug: z
		.boolean()
		.optional()
		.describe(
			"When the route fails, also return the real error (block, message, cause, user-code stack). The route's own callers never get it.",
		),
});

const debugErrorSchema = z.object({
	block: z.object({ id: z.string(), type: z.string(), name: z.string().optional() }).optional(),
	message: z.string(),
	detail: z.string().optional(),
	stack: z.string().optional(),
});

const debugTraceSchema = z.object({
	spans: z.array(
		z.object({
			blockId: z.string(),
			blockType: z.string(),
			blockName: z.string().optional(),
			outcome: z.enum(["success", "failure"]),
			ms: z.number(),
			output: z.string().optional(),
			error: z.string().optional(),
		}),
	),
	more: z.number().optional(),
});

export const callResultSchema = z.object({
	status: z.number().int().nullable(),
	contentType: z.string().nullable(),
	body: z.unknown(),
	/** the route's response headers */
	headers: z.record(z.string(), z.string()).optional(),
	/** the route alone, as the caller waited for it */
	durationMs: z.number().int().optional(),
	/** with `debug`: the run's recording id, when the run is recorded */
	runId: z.string().optional(),
	error: z.string().optional(),
	/** with `debug`: why the run failed, when it did */
	debugError: debugErrorSchema.optional(),
	/** with `debug`: the route's blocks that ran, short; the full run is its recording */
	debugTrace: debugTraceSchema.optional(),
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
	// a caller that already names the project's host keeps it (#742)
	if (!headers.has("host")) headers.set("host", url.host);
	const target = new URL(url);
	target.hostname = "127.0.0.1";
	return fetch(target, { ...init, headers });
}

export const NO_DEV_WORKER = "start a worker with FLUXIFY_ENV=development";

/**
 * The `Host` a call to a fixed dev worker URL must carry for a project with a
 * subdomain (#742). Without a fixed URL the call goes to the project's own
 * address, which is that host already.
 */
export function devHostHeader(
	subdomain: unknown,
	fixedWorkerUrl: string | undefined,
): Record<string, string> {
	return fixedWorkerUrl && typeof subdomain === "string" && subdomain
		? { host: projectHost(subdomain, baseDomain()) }
		: {};
}

/**
 * `path` on the development worker, and the project's development token to
 * send with it. DEV_WORKER_URL, else the project's address, whose proxy sends
 * `/_/dev` and `/_sandbox` to the development worker. The token never leaves
 * the admin: it is not in the answer, and the worker strips it before the
 * blocks run.
 *
 * A project with a subdomain answers dev requests only on that host (#742), so
 * every call to a dev worker goes through here and carries it. Through the
 * project's address the URL is that host already; a fixed DEV_WORKER_URL gets
 * it as the `Host` header.
 */
export async function devWorkerTarget(projectId: string, path: string, requestOrigin: string) {
	if (!(await devWorkerOnline(projectId))) throw new ConflictError(NO_DEV_WORKER);
	const base = DEV_WORKER_URL ?? specServerUrl(projectId, getEnv("SERVER_URL") || requestOrigin);
	const { token } = await readDevToken(projectId);
	const subdomain = projectSettingsCache[projectId]?.["settings.routing.subdomain"];
	return {
		url: new URL(path, base),
		headers: {
			[DEV_TOKEN_HEADER]: token,
			...devHostHeader(subdomain, DEV_WORKER_URL),
		},
	};
}

/**
 * Sends one real request to a route, the way the portal's playground does, on
 * the development worker at `/_/dev/<path>` (#736): it runs on development
 * data, never production's. Creator only, because it runs user code that may
 * write data.
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
	// it runs on the development worker, so development's switch is the one that counts
	if (!route.devActive)
		throw new BadRequestError("Route is switched off in development — turn it on to call it");

	const path = `/_/dev${fillPath(route.path!, input.params)}`;
	const { url, headers } = await devWorkerTarget(route.projectId!, path, requestOrigin);
	for (const [k, v] of Object.entries(input.query ?? {})) url.searchParams.set(k, v);

	return sendCall(url, route.method!, input, {
		target: { projectId: route.projectId!, id },
		timeoutSeconds: route.timeoutSeconds,
		headers,
	});
}

/**
 * One request to a worker, as an admin debug call: with `debug`, a token
 * signed here asks the worker for the run's real error and a short trace.
 * Shared by routes and sandboxes (#735); `headers` are added last, so a caller
 * cannot override them.
 */
export async function sendCall(
	url: URL,
	method: string,
	input: z.infer<typeof callBodySchema>,
	options: {
		target: { projectId: string; id: string };
		timeoutSeconds: number;
		headers?: Record<string, string>;
		/** gives up after this long instead of `timeoutSeconds` plus its slack */
		abortAfterMs?: number;
	},
): Promise<z.infer<typeof callResultSchema>> {
	const headers = new Headers(input.headers);
	// the caller's own header is never trusted: only a token signed here counts
	headers.delete(DEBUG_TOKEN_HEADER);
	const debugKey = input.debug ? routeDebugKey(getEnv("MASTER_ENCRYPTION_KEY")) : "";
	if (debugKey) headers.set(DEBUG_TOKEN_HEADER, signDebugToken(debugKey, options.target));
	for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
	let body: string | undefined;
	if (input.body !== undefined && method !== "GET") {
		body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
		if (!headers.has("content-type") && typeof input.body !== "string")
			headers.set("content-type", "application/json");
	}

	const startedAt = performance.now();
	try {
		const res = await fetchRoute(url, {
			method,
			headers,
			body,
			redirect: "manual",
			signal: AbortSignal.timeout(options.abortAfterMs ?? (options.timeoutSeconds + 5) * 1000),
		});
		const contentType = res.headers.get("content-type");
		const text = await res.text();
		let parsed: unknown = text;
		if (contentType?.includes("json")) {
			try {
				parsed = JSON.parse(text);
			} catch {}
		}
		const debugError = debugKey ? decodeDebugError(res.headers.get(DEBUG_ERROR_HEADER)) : undefined;
		const trace = debugKey ? decodeDebugTrace(res.headers.get(DEBUG_TRACE_HEADER)) : undefined;
		return {
			status: res.status,
			contentType,
			body: parsed,
			headers: Object.fromEntries(res.headers),
			durationMs: Math.round(performance.now() - startedAt),
			...(trace?.runId && { runId: trace.runId }),
			...(debugError && { debugError }),
			...(trace && {
				debugTrace: { spans: trace.spans, ...(trace.more ? { more: trace.more } : {}) },
			}),
		};
	} catch (error) {
		return {
			status: null,
			contentType: null,
			body: null,
			error: `Could not reach ${url.origin}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

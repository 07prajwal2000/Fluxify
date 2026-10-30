import type { Context as BlockContext, TriggerContext } from "@fluxify/blocks";
import { ValidationError } from "@fluxify/blocks/schema";
import type { AbstractLogger, HttpClient } from "@fluxify/lib";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import jwt from "jsonwebtoken";
import { getAppConfig } from "../../loaders/appconfigLoader";
import { observabilityIntegrationsCache, ownsIntegration } from "../../loaders/integrationsLoader";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";
import { observabilityLoggerFor } from "./observabilityLogger";
import { createSseApi } from "./sseRuntime";
import type { RequestOverrides } from "./types";

/** Default origin for in-process callers (test-suite runner) that predate the envelope. */
export const DEFAULT_TRIGGER: TriggerContext = {
	kind: "route",
	source: "http",
	reply: "sync",
};

/** what a run's JS sees as its globals: request helpers, logger, HTTP client, `abortSignal` */
export function setupContextVars(
	ctx: Context | undefined,
	requestData: {
		method: string;
		path: string;
		headers: Record<string, string>;
		query: Record<string, string | string[]>;
		body: any;
		params: Record<string, string>;
	},
	routeId: string,
	httpClient: HttpClient,
	projectId: string,
	overrides?: RequestOverrides,
	trigger: TriggerContext = DEFAULT_TRIGGER,
	signal?: AbortSignal,
	/** the route's SSE broker setting; absent outside a route */
	sseBrokerId?: string,
): BlockContext["vars"] {
	// built on the first getHeader: most routes never read a header
	let headers: Map<string, string> | undefined;
	const projectSettings = projectSettingsCache[projectId];
	// new key first, legacy second — the same order telemetry/destinations.ts
	// reads them in. Projects configured through the current UI only have the new one.
	let connectionId =
		projectSettings?.["settings.telemetry.logsConnectionId"] ||
		projectSettings?.["settings.ai.loggerConnectionId"] ||
		"";

	// Apply integration override for logger if present
	if (connectionId && overrides?.integrations) {
		const override = overrides.integrations.find((o) => o.existingId === connectionId);
		if (override && ownsIntegration(observabilityIntegrationsCache[override.newId], projectId)) {
			connectionId = override.newId;
		}
	}

	// created on the first use: most routes never log
	let logger: AbstractLogger | undefined;

	return {
		ValidationError: ValidationError,
		// origin of this execution (route/job/cron, http/nats/bullmq, sync/async)
		// so JS-runtime blocks can branch: `trigger.kind === "cron"`
		trigger,
		// a global in JS blocks; always set, so vars keeps one shape (#944)
		abortSignal: signal,
		sse: createSseApi({ projectId, request: ctx?.req.raw, brokerId: sseBrokerId }),
		jwt: {
			decode(token, options) {
				return jwt.decode(token, options) as Record<string, string>;
			},
			sign(payload, secretKey, options) {
				return jwt.sign(payload, secretKey, options);
			},
			verify(token, secretKey, options) {
				try {
					const payload = jwt.verify(token, secretKey, options) as Record<string, string>;
					return { payload, success: true };
				} catch (_error) {
					return { payload: null, success: false };
				}
			},
		},
		get logger() {
			logger ??= observabilityLoggerFor(connectionId, projectId, routeId);
			return logger;
		},
		// a graph may still assign its own, as it could while this was a plain value
		set logger(value) {
			logger = value;
		},
		getCookie(key) {
			return ctx ? getCookie(ctx, key) || "" : "";
		},
		getConfig(key) {
			if (overrides?.appConfigs) {
				const override = overrides.appConfigs.find((c) => c.key === key);
				if (override) return override.value;
			}
			return getAppConfig(projectId, key);
		},
		setCookie(name, options) {
			if (ctx) {
				setCookie(ctx, name, options?.value.toString() || "", {
					domain: options?.domain,
					path: options?.path,
					expires: new Date(options?.expiry),
					httpOnly: options?.httpOnly,
					secure: options?.secure,
					sameSite: options?.samesite || "Strict",
				});
			}
		},
		getHeader(key) {
			headers ??= new Map(
				Object.entries(requestData.headers).map(([name, value]) => [name.toLowerCase(), value]),
			);
			return headers.get(key.toLowerCase()) || "";
		},
		getQueryParam(key) {
			return requestData.query[key] as string | undefined;
		},
		getRequestBody() {
			return requestData.body;
		},
		// there is no reply yet; runWithMiddlewares swaps these in for the after chain
		getResponseBody: () => null,
		getResponseStatus: () => null,
		getRouteParam(key) {
			return requestData.params[key] || "";
		},
		httpRequestMethod: requestData.method,
		httpRequestRoute: requestData.path,
		setHeader(key, value) {
			if (ctx) {
				ctx.header(key, value);
			}
		},
		httpClient,
	};
}

import type { BlockTrace } from "@fluxify/blocks";
import type { RequestPayload } from "./types";

/** A request-local recorder supplied by the isolated execution process. */
export type RouteTrace = BlockTrace & {
	complete(outcome: "success" | "failure", statusCode?: number): void;
};

/**
 * Where a run's spans go (#254): the project's own OTLP backend, our recording
 * in Postgres, or both. Either one needs the span code and the recorder.
 */
export type TraceSinks = { tracingEnabled: boolean; recordExecution: boolean };

export const wantsSpans = (target: { tracingEnabled?: boolean; recordExecution?: boolean }) =>
	Boolean(target.tracingEnabled || target.recordExecution);

export type RouteTraceFactory = {
	start(
		route: {
			routeId: string;
			projectId: string;
			routeVersion: string;
			method: string;
			path: string;
			sandbox?: boolean;
		} & TraceSinks,
	): RouteTrace;
};

type TraceableRoute = {
	tracingEnabled?: boolean;
	recordExecution?: boolean;
	id: string;
	projectId?: string;
	routeVersion?: string;
	/** `id` is a sandbox's (#735) */
	sandbox?: boolean;
};

/** Keep recorder failures isolated from the route response path. */
export function startRouteTrace(
	route: TraceableRoute,
	payload: Pick<RequestPayload, "method" | "path">,
	traceFactory?: RouteTraceFactory,
): RouteTrace | undefined {
	if (!wantsSpans(route)) return;
	try {
		return traceFactory?.start({
			routeId: route.id,
			projectId: route.projectId!,
			routeVersion: route.routeVersion ?? "",
			method: payload.method,
			path: payload.path,
			tracingEnabled: Boolean(route.tracingEnabled),
			recordExecution: Boolean(route.recordExecution),
			...(route.sandbox ? { sandbox: true } : {}),
		});
	} catch {
		// Tracing is diagnostic data; a recorder bug must not fail traffic.
	}
}

export function traceCompleter(trace?: RouteTrace) {
	let complete = false;
	return (outcome: "success" | "failure", statusCode?: number) => {
		if (complete) return;
		complete = true;
		// typed number, but a response block can hand over its configured "200" (#625)
		const status = Number(statusCode);
		try {
			trace?.complete(outcome, Number.isInteger(status) ? status : undefined);
		} catch {
			// A failed IPC hand-off is telemetry loss, never a failed route.
		}
	};
}

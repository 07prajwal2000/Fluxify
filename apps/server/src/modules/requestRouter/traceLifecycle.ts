import type { BlockTrace } from "@fluxify/blocks";
import type { RequestPayload } from "./types";

/** A request-local recorder supplied by the isolated execution process. */
export type RouteTrace = BlockTrace & {
	complete(outcome: "success" | "failure", statusCode?: number): void;
};

export type RouteTraceFactory = {
	start(route: {
		routeId: string;
		projectId: string;
		routeVersion: string;
		method: string;
		path: string;
	}): RouteTrace;
};

type TraceableRoute = {
	tracingEnabled?: boolean;
	id: string;
	projectId?: string;
	routeVersion?: string;
};

/** Keep recorder failures isolated from the route response path. */
export function startRouteTrace(
	route: TraceableRoute,
	payload: RequestPayload,
	traceFactory?: RouteTraceFactory,
): RouteTrace | undefined {
	if (!route.tracingEnabled) return;
	try {
		return traceFactory?.start({
			routeId: route.id,
			projectId: route.projectId!,
			routeVersion: route.routeVersion ?? "",
			method: payload.method,
			path: payload.path,
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
		try {
			trace?.complete(outcome, statusCode);
		} catch {
			// A failed IPC hand-off is telemetry loss, never a failed route.
		}
	};
}

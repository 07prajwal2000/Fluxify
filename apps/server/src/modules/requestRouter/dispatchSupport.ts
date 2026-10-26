import { type BodyMode, DEFAULT_BODY_MODE, DEFAULT_CONTENT_TYPES } from "../../lib/routeConfig";
import type { RequestPayload } from "./types";

export type RouteExecutionObserver = {
	onRouteStart(route: {
		routeId: string;
		projectId: string;
		timeoutSeconds: number;
	}): (() => void) | void;
};

export async function runWithRouteObserver<T>(
	observer: RouteExecutionObserver | undefined,
	route: { id: string; projectId?: string; timeoutSeconds?: number },
	defaultTimeoutSeconds: number,
	run: () => Promise<T>,
): Promise<T> {
	// monitoring is off unless worker timeouts are: no extra async frame per request
	if (!observer) return run();
	const finish = observer.onRouteStart({
		routeId: route.id,
		projectId: route.projectId!,
		timeoutSeconds: route.timeoutSeconds ?? defaultTimeoutSeconds,
	});
	try {
		return await run();
	} finally {
		finish?.();
	}
}

export async function readRouteBody(
	payload: RequestPayload,
	acceptedContentTypes?: string[],
	bodyMode: BodyMode = DEFAULT_BODY_MODE,
) {
	if (!payload.bodyReader) return payload.body;
	return payload.bodyReader.parse(acceptedContentTypes ?? DEFAULT_CONTENT_TYPES, bodyMode);
}

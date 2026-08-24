import type { RequestPayload } from "./types";
import { DEFAULT_CONTENT_TYPES } from "../../lib/routeConfig";

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
	const finish = observer?.onRouteStart({
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
) {
	if (!payload.bodyReader) return payload.body;
	return payload.bodyReader.parse(
		acceptedContentTypes ?? DEFAULT_CONTENT_TYPES,
	);
}

import {
	ApiPlayground,
	type ApiPlaygroundRequest,
	type ApiPlaygroundResponse,
	type ApiPlaygroundState,
	Spinner,
} from "@fluxify/components";
import { isAxiosError } from "axios";
import { useCallback, useState } from "react";
import { useBlockErrorFocus } from "@/components/canvas/diagnostics/blockErrorFocus";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";
import { useCanvasPlaygroundCacheStore } from "@/store/canvasPlaygroundCache";

type RouteApiPlaygroundProps = {
	routeId: string;
	/** The public route runtime origin, not the portal API origin. */
	baseUrl: string;
	/** Override transport for auth, proxies, or a mock server. */
	onSend?: (request: ApiPlaygroundRequest) => Promise<ApiPlaygroundResponse>;
	className?: string;
	isFramed?: boolean;
	enableCache?: boolean;
};

/**
 * Fluxify-specific bridge: React Query owns route loading, while the component
 * package stays portable and receives only route data plus a request callback.
 */
export function RouteApiPlayground({
	routeId,
	baseUrl,
	onSend,
	className,
	isFramed,
	enableCache,
}: RouteApiPlaygroundProps) {
	const route = routesQuery.byId.useQuery(routeId);
	const selectBlock = useBlockErrorFocus();
	const send = onSend ?? ((request: ApiPlaygroundRequest) => sendThroughAdmin(routeId, request));
	const [initialState] = useState(() =>
		enableCache ? useCanvasPlaygroundCacheStore.getState().getPlaygroundState(routeId) : undefined,
	);

	const handleStateChange = useCallback(
		(state: ApiPlaygroundState) => {
			if (enableCache) {
				useCanvasPlaygroundCacheStore.getState().setPlaygroundState(routeId, state);
			}
		},
		[enableCache, routeId],
	);

	if (route.isLoading)
		return (
			<div className="grid h-full place-items-center">
				<Spinner />
			</div>
		);
	if (!route.data)
		return (
			<div className="grid h-full place-items-center text-sm text-muted">
				Route details are unavailable.
			</div>
		);
	return (
		<ApiPlayground
			className={className}
			isFramed={isFramed}
			baseUrl={baseUrl}
			onSend={send}
			onSelectBlock={selectBlock}
			route={route.data}
			initialState={initialState}
			onStateChange={handleStateChange}
		/>
	);
}

async function executeRequest(request: ApiPlaygroundRequest): Promise<ApiPlaygroundResponse> {
	const startedAt = performance.now();
	const headers = new Headers(request.headers);
	// The browser supplies multipart boundaries; a manually-set value would break them.
	if (request.body instanceof FormData) headers.delete("content-type");
	const response = await fetch(request.url, {
		method: request.method,
		headers,
		body: request.body,
	});
	const body = await response.text();
	return {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
		body,
		mimeType: response.headers.get("content-type") ?? undefined,
		durationMs: Math.round(performance.now() - startedAt),
		bytes: new TextEncoder().encode(body).byteLength,
	};
}

/**
 * The admin call endpoint is the only way to get a failed run's real error. It
 * takes JSON/text bodies and a creator role; anything else goes straight from
 * the browser as before, without the debug error.
 */
async function sendThroughAdmin(
	routeId: string,
	request: ApiPlaygroundRequest,
): Promise<ApiPlaygroundResponse> {
	if (request.body !== undefined && typeof request.body !== "string") {
		return executeRequest(request);
	}
	try {
		const result = await routesService.call(routeId, {
			params: request.pathParams,
			query: request.query,
			headers: request.headers,
			body: request.body || undefined,
			debug: true,
		});
		if (result.status === null) throw new Error(result.error ?? "Could not reach the route");
		const body = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
		return {
			status: result.status,
			headers: result.headers,
			body,
			mimeType: result.contentType ?? undefined,
			durationMs: result.durationMs,
			bytes: new TextEncoder().encode(body).byteLength,
			debugError: result.debugError,
		};
	} catch (error) {
		// viewers cannot use the call endpoint; they keep the plain playground
		if (isAxiosError(error) && error.response?.status === 403) return executeRequest(request);
		throw error;
	}
}

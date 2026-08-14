import { ApiPlayground, Spinner, type ApiPlaygroundRequest, type ApiPlaygroundResponse } from "@fluxify/components";
import { routesQuery } from "@/query/routesQuery";

type RouteApiPlaygroundProps = {
	routeId: string;
	/** The public route runtime origin, not the portal API origin. */
	baseUrl: string;
	/** Override transport for auth, proxies, or a mock server. */
	onSend?: (request: ApiPlaygroundRequest) => Promise<ApiPlaygroundResponse>;
	className?: string;
	isFramed?: boolean;
};

/**
 * Fluxify-specific bridge: React Query owns route loading, while the component
 * package stays portable and receives only route data plus a request callback.
 */
export function RouteApiPlayground({ routeId, baseUrl, onSend = executeRequest, className, isFramed }: RouteApiPlaygroundProps) {
	const route = routesQuery.byId.useQuery(routeId);
	if (route.isLoading) return <div className="grid h-full place-items-center"><Spinner /></div>;
	if (!route.data) return <div className="grid h-full place-items-center text-sm text-muted">Route details are unavailable.</div>;
	return <ApiPlayground className={className} isFramed={isFramed} baseUrl={baseUrl} onSend={onSend} route={route.data} />;
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

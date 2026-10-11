import {
	ApiPlayground,
	type ApiPlaygroundRequest,
	type ApiPlaygroundResponse,
	type ApiPlaygroundState,
	Spinner,
} from "@fluxify/components";
import { useCallback, useState } from "react";
import { TbPlayerRecord } from "react-icons/tb";
import { useBlockErrorFocus } from "@/components/canvas/diagnostics/blockErrorFocus";
import { EmptyState } from "@/components/common/EmptyState";
import {
	DEV_ROUTE_PREFIX,
	DEV_WORKER_MESSAGE,
	sendSandboxRequest,
} from "@/components/sandboxes/sandboxRequest";
import { useDevToken, useDevWorkerUrl } from "@/components/sandboxes/useDevWorkerUrl";
import { routesQuery } from "@/query/routesQuery";
import { sandboxesQuery } from "@/query/sandboxesQuery";
import { useCanvasPlaygroundCacheStore } from "@/store/canvasPlaygroundCache";

type RouteApiPlaygroundProps = {
	routeId: string;
	/** Override transport for auth, proxies, or a mock server. */
	onSend?: (request: ApiPlaygroundRequest) => Promise<ApiPlaygroundResponse>;
	className?: string;
	isFramed?: boolean;
	enableCache?: boolean;
	/** A recorded request to start from (#752); it replaces the cached state. */
	replay?: ApiPlaygroundState;
};

/**
 * Fluxify-specific bridge: React Query owns route loading, while the component
 * package stays portable and receives only route data plus a request callback.
 * Trying a route out always lands on the development worker, at `/_/dev` with
 * the project's development token, never on production.
 */
export function RouteApiPlayground({
	routeId,
	onSend,
	className,
	isFramed,
	enableCache,
	replay,
}: RouteApiPlaygroundProps) {
	const route = routesQuery.byId.useQuery(routeId);
	const selectBlock = useBlockErrorFocus();
	const projectId = route.data?.projectId ?? "";
	const devUrl = `${useDevWorkerUrl(projectId)}${DEV_ROUTE_PREFIX}`;
	const token = useDevToken(projectId);
	const { data: online = true } = sandboxesQuery.devWorker.useQuery(projectId);
	const send =
		onSend ??
		(async (request: ApiPlaygroundRequest) => {
			if (!token.data) {
				return {
					status: 0,
					statusText: "No token",
					body: "The development token could not be loaded, so the call was not sent.",
					mimeType: "text/plain",
				};
			}
			return sendSandboxRequest(request, token.data.token);
		});
	const [initialState] = useState(
		() =>
			replay ??
			(enableCache
				? useCanvasPlaygroundCacheStore.getState().getPlaygroundState(routeId)
				: undefined),
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
	if (!online) {
		return (
			<div className="grid h-full place-items-center p-6">
				<EmptyState
					icon={<TbPlayerRecord size={28} />}
					title="No development worker"
					description={DEV_WORKER_MESSAGE}
				/>
			</div>
		);
	}
	return (
		<ApiPlayground
			className={className}
			isFramed={isFramed}
			baseUrl={devUrl}
			onSend={send}
			onSelectBlock={selectBlock}
			route={route.data}
			initialState={initialState}
			onStateChange={handleStateChange}
		/>
	);
}

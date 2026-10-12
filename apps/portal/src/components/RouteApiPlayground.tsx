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
import { EnvPicker, type RunEnv } from "@/components/common/EnvPicker";
import { findNewRun, recordedRunIds } from "@/components/recordings/latestRun";
import {
	DEV_ROUTE_PREFIX,
	DEV_URL_NOTE,
	DEV_WORKER_MESSAGE,
	PROD_CONFIRM,
	PROD_URL_NOTE,
	sendProductionRequest,
	sendSandboxRequest,
} from "@/components/sandboxes/sandboxRequest";
import { useDevToken, useDevWorkerUrl } from "@/components/sandboxes/useDevWorkerUrl";
import { useProjectApiBaseUrl } from "@/components/settings/SubdomainField";
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
 *
 * The playground opens on **Development** and never remembers the choice (#739):
 * a development call goes to `/_/dev` with the project's development token, and
 * a production call goes to the route's public address with no token, to what a
 * real caller would hit. Production is offered only once a version is promoted.
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
	// The preview and the request use the project's own address, subdomain
	// included. Development adds `/_/dev`; production is the bare address.
	const apiBase = useProjectApiBaseUrl(projectId).replace(/\/+$/, "");
	const devShownUrl = `${apiBase}${DEV_ROUTE_PREFIX}`;
	const workerUrl = `${useDevWorkerUrl(projectId)}${DEV_ROUTE_PREFIX}`;
	const token = useDevToken(projectId);
	const { data: online = true } = sandboxesQuery.devWorker.useQuery(projectId);
	const [env, setEnv] = useState<RunEnv>("development");
	const [latestRun, setLatestRun] = useState<string | null>(null);
	const isProd = env === "production";
	const target = { type: "route", id: routeId } as const;
	const send =
		onSend ??
		(async (request: ApiPlaygroundRequest) => {
			if (!isProd) {
				if (!token.data) {
					return {
						status: 0,
						statusText: "No token",
						body: "The development token could not be loaded, so the call was not sent.",
						mimeType: "text/plain",
					};
				}
				const url = request.url.startsWith(devShownUrl)
					? workerUrl + request.url.slice(devShownUrl.length)
					: request.url;
				return sendSandboxRequest({ ...request, url }, token.data.token);
			}
			// production: the URL is what it is; the recording link waits for the run
			setLatestRun(null);
			const before = route.data?.recordExecution
				? new Set(await recordedRunIds(projectId, target))
				: null;
			const response = await sendProductionRequest(request);
			if (before) void findNewRun(projectId, target, before).then(setLatestRun);
			return response;
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
	// production does not need the development worker; development does
	if (!isProd && !online) {
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
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
				<EnvPicker
					env={env}
					onEnvChange={setEnv}
					productionDisabled={route.data.prodVersionId == null}
					confirm={PROD_CONFIRM}
					// the playground opens fresh each time; ask once per open, not per switch
					confirmOnce
				/>
				<span className="ml-auto text-xs text-muted">
					{isProd ? "Calls your public route address" : "Calls the development worker"}
				</span>
			</div>
			<div className="min-h-0 flex-1">
				<ApiPlayground
					className={className}
					isFramed={isFramed}
					baseUrl={isProd ? apiBase : devShownUrl}
					urlNote={isProd ? PROD_URL_NOTE : DEV_URL_NOTE}
					onSend={send}
					onSelectBlock={selectBlock}
					route={route.data}
					initialState={initialState}
					onStateChange={handleStateChange}
				/>
			</div>
			{latestRun && route.data.recordExecution && (
				<div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted">
					<span>This call was recorded.</span>
					<a
						className="text-accent hover:underline"
						href={`/${projectId}/canvas/${routeId}/executions?open=${latestRun}`}
					>
						Open recording
					</a>
				</div>
			)}
		</div>
	);
}

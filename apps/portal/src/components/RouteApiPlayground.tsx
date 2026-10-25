import {
	ApiPlayground,
	type ApiPlaygroundRequest,
	type ApiPlaygroundResponse,
	type ApiPlaygroundState,
	Spinner,
} from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { TbPlayerRecord } from "react-icons/tb";
import { useBlockErrorFocus } from "@/components/canvas/diagnostics/blockErrorFocus";
import { useOptionalCanvasPlayground } from "@/components/canvas/PlaygroundContext";
import { EmptyState } from "@/components/common/EmptyState";
import { EnvPicker, type RunEnv } from "@/components/common/EnvPicker";
import { findNewRun, recordedRunIds } from "@/components/recordings/latestRun";
import { ResponseSchemasPanel } from "@/components/routes/responseSchemas/ResponseSchemasPanel";
import { SaveSchemaButton } from "@/components/routes/responseSchemas/SaveSchemaButton";
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
import { useCanEditProject } from "@/store/auth";
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
	/** When the recording link is followed, so a modal host can close itself first. */
	onOpenRecording?: () => void;
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
	onOpenRecording,
}: RouteApiPlaygroundProps) {
	const route = routesQuery.byId.useQuery(routeId);
	const selectBlock = useBlockErrorFocus();
	// the canvas owns a playground modal of its own (#739); a page that hosts one
	// hands us onOpenRecording instead
	const playground = useOptionalCanvasPlayground();
	const projectId = route.data?.projectId ?? "";
	const canEdit = useCanEditProject(projectId);
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
				// A development call is recorded while the route's devRecordExecution is
				// on (#736), so its run is watched for exactly as production's is (#739).
				setLatestRun(null);
				const before = route.data?.devRecordExecution
					? new Set(await recordedRunIds(projectId, target))
					: null;
				const response = await sendSandboxRequest({ ...request, url }, token.data.token);
				if (before) void findNewRun(projectId, target, before).then(setLatestRun);
				return response;
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
					renderResponseActions={
						canEdit
							? (response) => <SaveSchemaButton routeId={routeId} response={response} />
							: undefined
					}
					schemasTab={<ResponseSchemasPanel routeId={routeId} projectId={projectId} />}
				/>
			</div>
			{/* the environment on screen is the one that keeps runs: development records
			    while devRecordExecution is on, production while recordExecution is (#739) */}
			{latestRun && (isProd ? route.data.recordExecution : route.data.devRecordExecution) && (
				<div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted">
					<span>This call was recorded.</span>
					{/* a run is a page of its own, unlike a sandbox's modal. The router carries
					    both the base path and the ?open=run, so no href is built here (#752) */}
					<Link
						className="text-accent hover:underline"
						to="/$projectId/canvas/$routeId/executions"
						params={{ projectId, routeId }}
						search={{ open: latestRun }}
						// leaving for a recording closes the playground: the canvas's own
						// modal, the sandbox way, or the host's, through the callback
						onClick={() => {
							playground?.close();
							onOpenRecording?.();
						}}
					>
						Open recording
					</Link>
				</div>
			)}
		</div>
	);
}

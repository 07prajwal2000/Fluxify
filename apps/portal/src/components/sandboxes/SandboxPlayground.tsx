import {
	ApiPlayground,
	type ApiPlaygroundRequest,
	type ApiPlaygroundState,
	Button,
} from "@fluxify/components";
import { useMemo, useState } from "react";
import { TbPlayerRecord } from "react-icons/tb";
import { useCanvasPlayground } from "@/components/canvas/PlaygroundContext";
import { EmptyState } from "@/components/common/EmptyState";
import { recordingsService } from "@/services/recordings";
import { DEV_WORKER_MESSAGE, sandboxBaseUrl, sendSandboxRequest } from "./sandboxRequest";
import { useDevToken, useDevWorkerUrl } from "./useDevWorkerUrl";

const POLL_MS = 700;
const POLL_TRIES = 6;

async function runIds(projectId: string, sandboxId: string, perPage: number) {
	const list = await recordingsService
		.getRuns(projectId, { type: "sandbox", id: sandboxId }, { perPage })
		.catch(() => null);
	return list?.data.map((run) => run.id) ?? [];
}

/** The newest run that was not there before the request, once it has been recorded. */
async function findNewRun(projectId: string, sandboxId: string, before: Set<string>) {
	for (let attempt = 0; attempt < POLL_TRIES; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		const fresh = (await runIds(projectId, sandboxId, 5)).find((id) => !before.has(id));
		if (fresh) return fresh;
	}
	return null;
}

/**
 * The sandbox's playground: any method, any path after `/_sandbox/<id>`, any
 * headers and body, sent to the development worker with the project's
 * development token. The recording of a call is one click away.
 */
export function SandboxPlayground({
	projectId,
	sandboxId,
	online,
	onOpenRun,
	replay,
}: {
	projectId: string;
	sandboxId: string;
	online: boolean;
	onOpenRun: (runId: string) => void;
	/** A recorded request to start from (#752). */
	replay?: { method: string; path: string; state: ApiPlaygroundState };
}) {
	const baseUrl = sandboxBaseUrl(useDevWorkerUrl(projectId), sandboxId);
	const playground = useCanvasPlayground();
	const [latestRun, setLatestRun] = useState<string | null>(null);
	const token = useDevToken(projectId);
	const route = useMemo(
		() => ({ path: replay?.path ?? "/", method: replay?.method ?? "GET" }),
		[replay],
	);

	async function onSend(request: ApiPlaygroundRequest) {
		setLatestRun(null);
		if (!token.data) {
			return {
				status: 0,
				statusText: "No token",
				body: "The development token could not be loaded, so the call was not sent.",
				mimeType: "text/plain",
			};
		}
		const before = new Set(await runIds(projectId, sandboxId, 20));
		const response = await sendSandboxRequest(request, token.data.token);
		void findNewRun(projectId, sandboxId, before).then(setLatestRun);
		return response;
	}

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
		<div className="flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1">
				<ApiPlayground
					route={route}
					baseUrl={baseUrl}
					onSend={onSend}
					isFramed={false}
					editableRequest
					defaultValidate={false}
					initialState={replay?.state}
				/>
			</div>
			{latestRun && (
				<div className="flex shrink-0 items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted">
					<span>This call was recorded.</span>
					<Button
						size="sm"
						variant="outline"
						onPress={() => {
							playground.close();
							onOpenRun(latestRun);
						}}
					>
						Open recording
					</Button>
				</div>
			)}
		</div>
	);
}

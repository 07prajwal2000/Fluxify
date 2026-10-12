import { type RecordingTarget, recordingsService } from "@/services/recordings";

const POLL_MS = 700;
const POLL_TRIES = 6;

async function runIds(projectId: string, target: RecordingTarget, perPage: number) {
	const list = await recordingsService.getRuns(projectId, target, { perPage }).catch(() => null);
	return list?.data.map((run) => run.id) ?? [];
}

/** The run ids already recorded, so a new one can be told apart after a call. */
export async function recordedRunIds(projectId: string, target: RecordingTarget, perPage = 20) {
	return runIds(projectId, target, perPage);
}

/** The newest run that was not there before the request, once it has been recorded. */
export async function findNewRun(
	projectId: string,
	target: RecordingTarget,
	before: Set<string>,
): Promise<string | null> {
	for (let attempt = 0; attempt < POLL_TRIES; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		const fresh = (await runIds(projectId, target, 5)).find((id) => !before.has(id));
		if (fresh) return fresh;
	}
	return null;
}

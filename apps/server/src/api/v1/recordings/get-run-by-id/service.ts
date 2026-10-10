import { NotFoundError } from "../../../../errors/notFoundError";
import type { RunTarget } from "../get-runs/repository";
import { withDuration } from "../get-runs/service";
import { getRecordedRunById } from "./repository";

export default async function handleRequest(projectId: string, target: RunTarget, runId: string) {
	const run = await getRecordedRunById(projectId, target, runId);
	if (!run) throw new NotFoundError("Recorded run not found");
	return withDuration(run);
}

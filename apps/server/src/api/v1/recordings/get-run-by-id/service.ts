import { NotFoundError } from "../../../../errors/notFoundError";
import type { FluxifyEnv } from "../../../../lib/env";
import type { RunTarget } from "../get-runs/repository";
import { presentRun } from "../get-runs/service";
import { getRecordedRunById } from "./repository";

export default async function handleRequest(
	projectId: string,
	target: RunTarget,
	runId: string,
	env?: FluxifyEnv,
) {
	const run = await getRecordedRunById(projectId, target, runId, env);
	if (!run) throw new NotFoundError("Recorded run not found");
	return presentRun(run);
}

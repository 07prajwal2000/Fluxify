import { NotFoundError } from "../../../../errors/notFoundError";
import type { SuiteTarget } from "../../../../modules/testRunner/target";
import { getTestRunById } from "./repository";

export default async function handleRequest(projectId: string, target: SuiteTarget, runId: string) {
	const run = await getTestRunById(projectId, target, runId);
	if (!run) throw new NotFoundError("Test run not found");
	return run;
}

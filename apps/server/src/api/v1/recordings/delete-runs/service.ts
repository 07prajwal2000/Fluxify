import { ServerError } from "../../../../errors/serverError";
import type { SuiteTarget } from "../../../../modules/testRunner/target";
import { deleteRecordedRuns } from "./repository";

export default async function handleRequest(
	projectId: string,
	target: SuiteTarget,
	runId?: string,
) {
	try {
		return { deleted: await deleteRecordedRuns(projectId, target, runId) };
	} catch (err: any) {
		throw new ServerError(err.message || "Failed to delete the recorded runs");
	}
}

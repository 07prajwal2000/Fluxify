import { ServerError } from "../../../../errors/serverError";
import type { SuiteTarget } from "../../../../modules/testRunner/target";
import { deleteTestRuns } from "./repository";

export default async function handleRequest(projectId: string, target: SuiteTarget) {
	try {
		return { deleted: await deleteTestRuns(projectId, target) };
	} catch (err: any) {
		throw new ServerError(err.message || "Failed to clear the run history");
	}
}

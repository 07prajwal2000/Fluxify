import { ServerError } from "../../../../errors/serverError";
import { audit } from "../../../../modules/audit";
import type { SuiteTarget } from "../../../../modules/testRunner/target";
import { deleteTestRuns } from "./repository";

export default async function handleRequest(projectId: string, target: SuiteTarget) {
	try {
		// recorded first: a failed publish leaves the history alone
		await audit.record({
			projectId,
			resourceType: "test_run",
			resourceId: target.id,
			action: "delete",
			changedFields: [],
			message: `Cleared the run history of a ${target.type}`,
		});
		return { deleted: await deleteTestRuns(projectId, target) };
	} catch (err: any) {
		throw new ServerError(err.message || "Failed to clear the run history");
	}
}

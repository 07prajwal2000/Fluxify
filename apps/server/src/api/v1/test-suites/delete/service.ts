import { ServerError } from "../../../../errors/serverError";
import { audit } from "../../../../modules/audit";
import { suiteProjectId } from "../audit";
import { deleteTestSuite } from "./repository";

export default async function handleRequest(id: string) {
	try {
		// recorded first: the suite still names its project, and a failed publish leaves it alone
		await audit.record({
			projectId: suiteProjectId(id),
			resourceType: "test_suite",
			resourceId: id,
			action: "delete",
			changedFields: [],
		});
		await deleteTestSuite(id);
		return { success: true };
	} catch (err: any) {
		throw new ServerError(err.message || "Failed to delete test suite");
	}
}

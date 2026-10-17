import { targetOf, targetProject } from "../../../modules/testRunner/target";
import { getTestSuiteById } from "./get-by-id/repository";

/** A suite has no project column; it belongs to its target's project. Pass it to `audit.record` as is. */
export const suiteProjectId = (id: string) => async () => {
	const suite = await getTestSuiteById(id);
	return suite ? ((await targetProject(targetOf(suite))) ?? null) : null;
};

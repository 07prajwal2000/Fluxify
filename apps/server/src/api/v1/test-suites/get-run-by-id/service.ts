import { NotFoundError } from "../../../../errors/notFoundError";
import { getTestRunById } from "./repository";

export default async function handleRequest(
	projectId: string,
	routeId: string,
	runId: string,
) {
	const run = await getTestRunById(projectId, routeId, runId);
	if (!run) throw new NotFoundError("Test run not found");
	return run;
}

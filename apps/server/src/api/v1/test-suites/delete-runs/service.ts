import { ServerError } from "../../../../errors/serverError";
import { deleteTestRuns } from "./repository";

export default async function handleRequest(projectId: string, routeId: string) {
	try {
		return { deleted: await deleteTestRuns(projectId, routeId) };
	} catch (err: any) {
		throw new ServerError(err.message || "Failed to clear the run history");
	}
}

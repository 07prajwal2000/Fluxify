import { ServerError } from "../../../../errors/serverError";
import { getProjectTestSuites } from "./repository";

export default async function handleRequest(projectId: string) {
	try {
		return await getProjectTestSuites(projectId);
	} catch (err: any) {
		throw new ServerError(err.message || "Failed to list test suites");
	}
}

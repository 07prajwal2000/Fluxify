import { ServerError } from "../../../../errors/serverError";
import type { SuiteTarget } from "../../../../modules/testRunner/target";
import { getAllTestSuites } from "./repository";

export default async function handleRequest(target: SuiteTarget) {
	try {
		return await getAllTestSuites(target);
	} catch (err: any) {
		throw new ServerError(err.message || "Failed to list test suites");
	}
}

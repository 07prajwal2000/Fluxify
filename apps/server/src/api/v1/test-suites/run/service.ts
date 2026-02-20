import { runSuiteAssertions } from "../runner";
import { ServerError } from "../../../../errors/serverError";
import { getTestSuiteWithRoute } from "./repository";

export default async function handleRequest(suiteId: string) {
  try {
    const { suite, route } = await getTestSuiteWithRoute(suiteId);

    if (!suite) throw new Error("Test suite not found");
    if (!route) throw new Error("Associated route not found");

    return runSuiteAssertions(suite, route);
  } catch (err: any) {
    throw new ServerError(err.message || "Failed to run test suite");
  }
}

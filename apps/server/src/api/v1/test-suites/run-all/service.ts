import { runSuiteAssertions } from "../runner";
import { ServerError } from "../../../../errors/serverError";
import { getRouteAndAllTestSuites } from "./repository";

export default async function handleRequest(routeId: string) {
  try {
    const { suites, route } = await getRouteAndAllTestSuites(routeId);

    if (!route) throw new Error("Associated route not found");

    const results = [];
    for (const suite of suites) {
      try {
        const suiteResult = await runSuiteAssertions(suite, route);
        results.push({
          suite_id: suite.id,
          name: suite.name,
          success: suiteResult.success,
          errors: suiteResult.result
            .filter((r) => !r.success)
            .map((r) => r.message),
        });
      } catch (e: unknown) {
        results.push({
          suite_id: suite.id,
          name: suite.name,
          success: false,
          errors: [e instanceof Error ? e.message : String(e)],
        });
      }
    }

    const allPassed = results.length > 0 && results.every((r) => r.success);
    return {
      success: allPassed,
      result: results,
    };
  } catch (err: any) {
    throw new ServerError(err.message || "Failed to run all test suites");
  }
}

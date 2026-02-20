import { ServerError } from "../../../../errors/serverError";
import { getTestSuiteById } from "./repository";

export default async function handleRequest(id: string) {
  try {
    const suite = await getTestSuiteById(id);
    if (!suite) throw new Error("Test suite not found");
    return suite;
  } catch (err: any) {
    throw new ServerError(err.message || "Failed to get test suite");
  }
}

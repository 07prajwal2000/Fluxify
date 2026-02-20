import { ServerError } from "../../../../errors/serverError";
import { getAllTestSuites } from "./repository";

export default async function handleRequest(routeId: string) {
  try {
    return await getAllTestSuites(routeId);
  } catch (err: any) {
    throw new ServerError(err.message || "Failed to list test suites");
  }
}

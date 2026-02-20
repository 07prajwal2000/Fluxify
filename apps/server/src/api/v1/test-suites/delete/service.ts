import { ServerError } from "../../../../errors/serverError";
import { deleteTestSuite } from "./repository";

export default async function handleRequest(id: string) {
  try {
    await deleteTestSuite(id);
    return { success: true };
  } catch (err: any) {
    throw new ServerError(err.message || "Failed to delete test suite");
  }
}

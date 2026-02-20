import { ServerError } from "../../../../errors/serverError";
import { updateTestSuite } from "./repository";

export default async function handleRequest(id: string, data: any) {
  try {
    const updateData = Object.fromEntries(
      Object.entries(data).filter(([_, v]) => v !== undefined),
    );

    if (Object.keys(updateData).length === 0) {
      return { id };
    }

    const result = await updateTestSuite(id, updateData);

    if (!result) throw new Error("Test suite not found to update");

    return result;
  } catch (err: any) {
    throw new ServerError(err.message || "Failed to update test suite");
  }
}

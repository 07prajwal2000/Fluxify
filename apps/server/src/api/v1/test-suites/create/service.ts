import { ServerError } from "../../../../errors/serverError";
import { createTestSuite } from "./repository";
import { requestBodySchema } from "./dto";
import { z } from "zod";
import { generateID } from "@fluxify/lib";

export default async function handleRequest(
  data: z.infer<typeof requestBodySchema>,
) {
  try {
    const { route_id, ...rest } = data;
    return await createTestSuite({
      id: generateID(),
      name: rest.name,
      description: rest.description,
      routeId: route_id,
    });
  } catch (err: any) {
    throw new ServerError(err.message || "Failed to create test suite");
  }
}

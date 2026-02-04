import { z } from "zod";
import { requestRouteSchema, responseSchema } from "./dto";
import { getIntegrationById } from "./repository";
import { testIntegrationConnection } from "../test-connection/service";
import { NotFoundError } from "../../../../errors/notFoundError";
import { BadRequestError } from "../../../../errors/badRequestError";

export default async function handleRequest(
  params: z.infer<typeof requestRouteSchema>,
): Promise<z.infer<typeof responseSchema>> {
  const integration = await getIntegrationById(params.id);
  if (!integration) {
    throw new NotFoundError("Integration not found");
  }
  const result = await testIntegrationConnection(
    integration.group as any,
    integration.variant as any,
    integration.config,
  );
  if (!result.success) {
    throw new BadRequestError(result.error || "Failed to test connection");
  }

  return result;
}

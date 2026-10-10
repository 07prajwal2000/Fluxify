import type { OtlpSignal } from "@fluxify/adapters";
import type { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import { NotFoundError } from "../../../../errors/notFoundError";
import type { FluxifyEnv } from "../../../../lib/env";
import { ADMIN_CONNECTION_ENV, configForAdminEnv } from "../adminEnv";
import { CONNECTION_TEST_TIMEOUT_MS, testIntegrationConnection } from "../test-connection/service";
import type { requestRouteSchema, responseSchema } from "./dto";
import { getIntegrationById } from "./repository";

export default async function handleRequest(
	params: z.infer<typeof requestRouteSchema>,
	signal: OtlpSignal = "logs",
	/** development unless the caller is the portal's "Test production credentials" */
	env: FluxifyEnv = ADMIN_CONNECTION_ENV,
): Promise<z.infer<typeof responseSchema>> {
	const integration = await getIntegrationById(params.projectId, params.id);
	if (!integration) {
		throw new NotFoundError(`Integration ${params.id} not found in project ${params.projectId}`);
	}
	const result = await testIntegrationConnection(
		params.projectId,
		integration.group as any,
		integration.variant as any,
		configForAdminEnv(integration, env),
		signal,
		CONNECTION_TEST_TIMEOUT_MS,
		env,
	);
	if (!result.success) {
		throw new BadRequestError(result.error || "Failed to test connection");
	}

	return result;
}

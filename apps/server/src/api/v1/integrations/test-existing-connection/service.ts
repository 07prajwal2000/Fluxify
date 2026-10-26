import type { OtlpSignal } from "@fluxify/adapters";
import type { z } from "zod";
import { NotFoundError } from "../../../../errors/notFoundError";
import type { FluxifyEnv } from "../../../../lib/env";
import { ADMIN_CONNECTION_ENV, configForAdminEnv } from "../adminEnv";
import { mcpOAuthFor } from "../mcp-oauth/store";
import { CONNECTION_TEST_TIMEOUT_MS, testIntegrationConnection } from "../test-connection/service";
import type { requestRouteSchema, responseSchema } from "./dto";
import { getIntegrationById } from "./repository";

export default async function handleRequest(
	params: z.infer<typeof requestRouteSchema>,
	signal: OtlpSignal = "logs",
	/** development unless the caller is the portal's "Test production credentials" */
	env: FluxifyEnv = ADMIN_CONNECTION_ENV,
	/** the caller hung up or pressed Cancel */
	abort?: AbortSignal,
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
		integration.group === "mcp" ? mcpOAuthFor(integration, env) : undefined,
		integration.id,
		abort,
	);
	// a failed probe is an answer with its reason, as for an unsaved config (#690)
	return result;
}

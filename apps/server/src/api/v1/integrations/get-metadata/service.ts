import type { IntrospectedTable } from "@fluxify/adapters";
import type { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { runIntegrationOp } from "../../../../modules/integrationOps/dispatch";
import { ADMIN_CONNECTION_ENV, configForAdminEnv } from "../adminEnv";
import { getIntegrationByID } from "../get-by-id/repository";
import type { requestRouteSchema, responseSchema } from "./dto";

export default async function handleRequest(
	params: z.infer<typeof requestRouteSchema>,
): Promise<z.infer<typeof responseSchema>> {
	const integration = await getIntegrationByID(params.projectId, params.integrationId);
	if (!integration) {
		throw new NotFoundError("Integration not found");
	}
	// ponytail: databases only; other groups get their own metadata shape when they need one.
	if (integration.group !== "database") {
		throw new BadRequestError("Metadata is only available for database integrations");
	}

	// the variant's `describe`, with the development credentials, as every admin-side connection (#733)
	const metadata = (await runIntegrationOp("describe", {
		projectId: params.projectId,
		env: ADMIN_CONNECTION_ENV,
		integrationId: integration.id,
		group: integration.group,
		variant: integration.variant!,
		config: configForAdminEnv(integration, ADMIN_CONNECTION_ENV),
	}).catch((error) => {
		if (error instanceof BadRequestError) throw error;
		throw new BadRequestError(
			`Failed to read schema: ${error instanceof Error ? error.message : String(error)}`,
		);
	})) as { tables: IntrospectedTable[] };

	return {
		id: integration.id,
		name: integration.name!,
		group: integration.group!,
		variant: integration.variant!,
		metadata,
	};
}

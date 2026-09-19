import type { z } from "zod";
import { NotFoundError } from "../../../../errors/notFoundError";
import type { responseSchema } from "./dto";
import { getIntegrationByID } from "./repository";

export default async function handleRequest(
	projectId: string,
	id: string,
): Promise<z.infer<typeof responseSchema>> {
	const integration = await getIntegrationByID(projectId, id);
	if (!integration) {
		throw new NotFoundError("Integration not found");
	}
	return {
		id: integration.id,
		name: integration.name!,
		group: integration.group!,
		variant: integration.variant!,
		config: integration.config as any,
	};
}

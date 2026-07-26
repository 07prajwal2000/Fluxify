import {
	db,
	agentHarnessConversationsEntity,
	integrationsEntity,
} from "@fluxify/server";
import { and, eq } from "drizzle-orm";

export async function getConversationById(conversationId: string) {
	const result = await db
		.select()
		.from(agentHarnessConversationsEntity)
		.where(eq(agentHarnessConversationsEntity.id, conversationId))
		.limit(1);
	return result[0];
}

/** Fetches an integration by id scoped to a project (group + config only). */
export async function getProjectIntegration(
	integrationId: string,
	projectId: string,
) {
	const result = await db
		.select({
			group: integrationsEntity.group,
			config: integrationsEntity.config,
		})
		.from(integrationsEntity)
		.where(
			and(
				eq(integrationsEntity.id, integrationId),
				eq(integrationsEntity.projectId, projectId),
			),
		)
		.limit(1);
	return result[0];
}

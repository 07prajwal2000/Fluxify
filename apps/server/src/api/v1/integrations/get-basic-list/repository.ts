import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { integrationsEntity } from "../../../../db/schema";

export const getBasicListRepository = async (projectId: string) => {
	return await db
		.select({
			id: integrationsEntity.id,
			name: integrationsEntity.name,
			group: integrationsEntity.group,
			variant: integrationsEntity.variant,
		})
		.from(integrationsEntity)
		.where(eq(integrationsEntity.projectId, projectId));
};

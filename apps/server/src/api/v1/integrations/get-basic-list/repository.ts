import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { integrationsEntity } from "../../../../db/schema";

export const getBasicListRepository = async (
	projectId: string,
	useForHarness?: boolean,
) => {
	return await db
		.select({
			id: integrationsEntity.id,
			name: integrationsEntity.name,
			group: integrationsEntity.group,
			variant: integrationsEntity.variant,
		})
		.from(integrationsEntity)
		.where(
			and(
				eq(integrationsEntity.projectId, projectId),
				useForHarness === undefined
					? undefined
					: and(
							eq(integrationsEntity.group, "ai"),
							// A missing attribute counts as false.
							sql`coalesce(${integrationsEntity.config} ->> 'useForHarness', 'false') = ${String(useForHarness)}`,
						),
			),
		);
};

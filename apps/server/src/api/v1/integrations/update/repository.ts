import { and, eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { type DbTransactionType, db } from "../../../../db";
import { integrationsEntity } from "../../../../db/schema";

export async function updateIntegration(
	projectId: string,
	id: string,
	data: {
		name: string;
		config: any;
		/** undefined leaves it alone, null removes it */
		devConfig?: any;
		syncDev?: boolean;
		tags?: string[];
		/** mcp: keep the stored OAuth connection of these configs, whatever else the new ones say */
		keepOAuth?: { config?: boolean; devConfig?: boolean };
	},
	tx?: DbTransactionType,
): Promise<any> {
	// the connection is copied by the database from the row as it is now, not from what the
	// caller read earlier: a token refreshed in between must not be written back stale
	const keep = (value: any, column: AnyPgColumn, keepIt?: boolean) =>
		keepIt && value
			? sql`${JSON.stringify(value)}::text::jsonb || jsonb_strip_nulls(jsonb_build_object('oauth', ${column}->'oauth'))`
			: value;
	const result = await (tx ?? db)
		.update(integrationsEntity)
		.set({
			name: data.name,
			config: keep(data.config, integrationsEntity.config, data.keepOAuth?.config),
			devConfig: keep(data.devConfig, integrationsEntity.devConfig, data.keepOAuth?.devConfig),
			syncDev: data.syncDev,
			tags: data.tags ? data.tags.join(",") : undefined,
		})
		.where(and(eq(integrationsEntity.id, id), eq(integrationsEntity.projectId, projectId)))
		.returning();
	return result;
}

export async function integrationExistByName(
	projectId: string,
	name: string,
	tx?: DbTransactionType,
) {
	const result = await (tx ?? db)
		.select({ id: integrationsEntity.id })
		.from(integrationsEntity)
		.where(and(eq(integrationsEntity.name, name), eq(integrationsEntity.projectId, projectId)));
	return result[0];
}

export async function getIntegrationById(projectId: string, id: string, tx?: DbTransactionType) {
	const result = await (tx ?? db)
		.select()
		.from(integrationsEntity)
		.where(and(eq(integrationsEntity.id, id), eq(integrationsEntity.projectId, projectId)));
	return result.length > 0 ? result[0] : null;
}

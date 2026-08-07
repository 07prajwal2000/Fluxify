import { sql } from "drizzle-orm";
import { db, DbTransactionType } from "../../../db";
import { httpRouteConfigEntity } from "../../../db/schema";

/**
 * `route_config` is an open bag, so a patch merges into whatever is already
 * stored (`||` is a top-level jsonb merge) instead of replacing it. A caller
 * that only knows about content types must not drop a key added later.
 */
export async function patchRouteConfig(
	routeId: string,
	projectId: string | null | undefined,
	patch: Record<string, unknown>,
	tx?: DbTransactionType,
) {
	await (tx ?? db)
		.insert(httpRouteConfigEntity)
		.values({ routeId, projectId: projectId ?? undefined, routeConfig: patch })
		.onConflictDoUpdate({
			target: httpRouteConfigEntity.routeId,
			set: {
				routeConfig: sql`${httpRouteConfigEntity.routeConfig} || ${JSON.stringify(patch)}::jsonb`,
				updatedAt: new Date(),
			},
		});
}

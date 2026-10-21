import { eq, sql } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../db";
import { httpRouteConfigEntity } from "../../../db/schema";
import { parseRouteConfig } from "../../../lib/routeConfig";

/** The stored config, read through the same parser the workers use. */
export async function readRouteConfig(routeId: string, tx?: DbTransactionType) {
	const [row] = await (tx ?? db)
		.select({ routeConfig: httpRouteConfigEntity.routeConfig })
		.from(httpRouteConfigEntity)
		.where(eq(httpRouteConfigEntity.routeId, routeId));
	return parseRouteConfig(row?.routeConfig);
}

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
				// `excluded` is the row above, already encoded by the jsonb column. A
				// hand-stringified param gets encoded again and lands as a jsonb string.
				// `||` only merges object into object; a non-object row gets replaced.
				routeConfig: sql`CASE WHEN jsonb_typeof(${httpRouteConfigEntity.routeConfig}) = 'object'
					THEN ${httpRouteConfigEntity.routeConfig} || excluded.route_config
					ELSE excluded.route_config END`,
				updatedAt: new Date(),
			},
		});
}

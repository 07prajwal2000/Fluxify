import { and, eq, inArray, sql } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../db";
import { httpRouteConfigEntity, integrationsEntity } from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { parseRouteConfig, SSE_BROKER_VARIANTS } from "../../../lib/routeConfig";

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

/**
 * The SSE broker (#1024) is written as given: `null` clears it, `undefined`
 * leaves it alone. Only the project's own NATS or Redis integration is taken;
 * the runtime checks the same, this just says so at save time.
 */
export async function patchSseBroker(
	routeId: string,
	projectId: string | null | undefined,
	sseBrokerId: string | null | undefined,
	tx?: DbTransactionType,
) {
	if (sseBrokerId === undefined) return;
	if (sseBrokerId !== null) {
		const [broker] = await (tx ?? db)
			.select({ id: integrationsEntity.id })
			.from(integrationsEntity)
			.where(
				and(
					eq(integrationsEntity.id, sseBrokerId),
					eq(integrationsEntity.projectId, projectId ?? ""),
					inArray(integrationsEntity.variant, SSE_BROKER_VARIANTS),
				),
			);
		if (!broker)
			throw new BadRequestError(
				"The SSE broker must be a NATS or Redis integration of this project",
			);
	}
	await patchRouteConfig(routeId, projectId, { sseBrokerId }, tx);
}

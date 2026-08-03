import {
	db,
	routesEntity,
	agentHarnessSubArtifactsEntity as subArtifacts,
} from "@fluxify/server";
import { and, asc, eq, inArray } from "drizzle-orm";

/** Everything about one output, payload included. Conversation-scoped so a
 *  client can't read another chat's work by guessing an id. */
export async function getSubArtifactById(
	conversationId: string,
	subArtifactId: string,
) {
	const [row] = await db
		.select()
		.from(subArtifacts)
		.where(
			and(
				eq(subArtifacts.id, subArtifactId),
				eq(subArtifacts.conversationId, conversationId),
			),
		)
		.limit(1);
	return row;
}

/** Payload omitted — see the note on `subArtifactSummarySchema`. */
export async function listSubArtifactsByRun(conversationId: string, runId: string) {
	return db
		.select({
			id: subArtifacts.id,
			artifactId: subArtifacts.artifactId,
			kind: subArtifacts.kind,
			action: subArtifacts.action,
			appliedAt: subArtifacts.appliedAt,
			createdAt: subArtifacts.createdAt,
		})
		.from(subArtifacts)
		.where(
			and(
				eq(subArtifacts.runId, runId),
				eq(subArtifacts.conversationId, conversationId),
			),
		)
		.orderBy(asc(subArtifacts.createdAt));
}

/** Siblings of one artifact. Payload is needed here — the dependency between a
 *  canvas and its route lives inside it. */
export async function getArtifactSubArtifacts(
	conversationId: string,
	artifactId: string,
) {
	return db
		.select({
			id: subArtifacts.id,
			kind: subArtifacts.kind,
			action: subArtifacts.action,
			appliedAt: subArtifacts.appliedAt,
			payload: subArtifacts.payload,
		})
		.from(subArtifacts)
		.where(
			and(
				eq(subArtifacts.artifactId, artifactId),
				eq(subArtifacts.conversationId, conversationId),
			),
		)
		.orderBy(asc(subArtifacts.createdAt));
}

/** Idempotent — re-applying just refreshes the timestamp. */
export async function markSubArtifactsApplied(
	conversationId: string,
	ids: string[],
	appliedAt: Date,
) {
	if (ids.length === 0) return [];
	return db
		.update(subArtifacts)
		.set({ appliedAt })
		.where(
			and(
				inArray(subArtifacts.id, ids),
				eq(subArtifacts.conversationId, conversationId),
			),
		)
		.returning({
			id: subArtifacts.id,
			kind: subArtifacts.kind,
			action: subArtifacts.action,
			appliedAt: subArtifacts.appliedAt,
		});
}

/** The id an agent invented for a route is not the id storage chose, so the
 *  payload is rewritten once the real one is known. */
export async function updateSubArtifactPayload(
	conversationId: string,
	subArtifactId: string,
	payload: Record<string, any>,
) {
	await db
		.update(subArtifacts)
		.set({ payload })
		.where(
			and(
				eq(subArtifacts.id, subArtifactId),
				eq(subArtifacts.conversationId, conversationId),
			),
		);
}

/** Which of these route ids are actually live in the project. */
export async function findExistingRouteIds(projectId: string, routeIds: string[]) {
	if (routeIds.length === 0) return new Set<string>();
	const rows = await db
		.select({ id: routesEntity.id })
		.from(routesEntity)
		.where(
			and(eq(routesEntity.projectId, projectId), inArray(routesEntity.id, routeIds)),
		);
	return new Set(rows.map((r) => r.id));
}

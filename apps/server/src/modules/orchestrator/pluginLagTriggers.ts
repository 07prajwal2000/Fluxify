import { logger } from "@fluxify/common";
import { LAG_PER_WORKER } from "@fluxify/sdk/triggers";
import { and, eq, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { triggersEntity } from "../../db/schema";
import { getEnv } from "../../lib/env";
import { findTriggerKind } from "../plugins/triggerKinds";
import { lagMetricsToken, lagTargetOf } from "../triggers/lagShared";
import { pluginTriggerKind } from "../triggers/types";
import type { ExternalTrigger } from "./kubernetesExternal";

/**
 * Plugin triggers whose claim scales on their own lag (#963): a row of a kind
 * that still defines `lag` and holds a `lagPerWorker`, on in either environment
 * with a workflow attached, like the queue triggers. A kind whose new version
 * dropped `lag` is skipped, since no worker answers for it any more and KEDA
 * would only be failing reads. Without a stored value the claim keeps scaling on
 * cpu and memory.
 */

type Row = { id: string; groupId: string; type: string; projectId: string; source: unknown };

/** The scaler a row needs, or null for one that does not scale on lag. */
export function lagTrigger(row: Row, definesLag: boolean, token: string): ExternalTrigger | null {
	if (!definesLag) return null;
	const lagPerWorker = lagTargetOf(row.source);
	if (lagPerWorker === undefined) {
		if ((row.source as Record<string, unknown> | null)?.[LAG_PER_WORKER] !== undefined)
			logger.warn(
				`trigger ${row.id}: its ${LAG_PER_WORKER} is not a whole number of at least 1, so it does not scale its claim`,
				"ORCHESTRATOR",
			);
		return null;
	}
	return { id: row.id, type: "plugin-lag", lagPerWorker, token };
}

/** whether the approved plugin version of the project still defines `lag` for `kind` */
const kindDefinesLag = async (projectId: string, kind: string) =>
	!!(await findTriggerKind(projectId, kind))?.entry.lag;

export async function pluginLagTriggersByGroup(
	definesLag: (projectId: string, kind: string) => Promise<boolean> = kindDefinesLag,
): Promise<Map<string, ExternalTrigger[]>> {
	const byGroup = new Map<string, ExternalTrigger[]>();
	const rows: Row[] = await db
		.select({
			id: triggersEntity.id,
			groupId: triggersEntity.groupId,
			type: triggersEntity.type,
			projectId: triggersEntity.projectId,
			source: triggersEntity.source,
		})
		.from(triggersEntity)
		.where(
			and(
				like(triggersEntity.type, "plugin:%"),
				or(eq(triggersEntity.active, true), eq(triggersEntity.devActive, true)),
				isNotNull(triggersEntity.workflowId),
				sql`${triggersEntity.source} ->> ${LAG_PER_WORKER}::text is not null`,
			),
		);
	if (rows.length === 0) return byGroup;
	const token = lagMetricsToken(getEnv("MASTER_ENCRYPTION_KEY"));
	const kinds = new Map<string, Promise<boolean>>();
	for (const row of rows) {
		const kind = pluginTriggerKind(row.type);
		const key = `${row.projectId}:${kind}`;
		if (!kinds.has(key)) kinds.set(key, definesLag(row.projectId, kind));
		const trigger = lagTrigger(row, await kinds.get(key)!, token);
		if (trigger) byGroup.set(row.groupId, [...(byGroup.get(row.groupId) ?? []), trigger]);
	}
	return byGroup;
}

/** two group maps as one: a group's triggers from both, the first's first */
export function mergeByGroup<T>(...maps: Map<string, T[]>[]) {
	const merged = new Map<string, T[]>();
	for (const map of maps)
		for (const [group, items] of map) merged.set(group, [...(merged.get(group) ?? []), ...items]);
	return merged;
}

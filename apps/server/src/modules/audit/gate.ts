import { canRecordAudit } from "../../lib/edition";

export const AUDIT_ENABLED_KEY = "auditLogs.enabled";
const TTL_MS = 30_000;

/**
 * Test seam: lets an audit spec or e2e stack turn logging on without a licence
 * or a project row. `undefined` means "ask the real thing". Nothing else reads it.
 */
export const gateOverride: { licensed?: boolean; projectEnabled?: boolean } = {};

type ProjectInfo = { name: string; slug: string; enabled: boolean };
const cache = new Map<string, { at: number; info: ProjectInfo | null }>();

/** Drops the cached flag, name and slug; call after any change to the project. */
export const forgetProject = (projectId?: string) =>
	projectId ? cache.delete(projectId) : cache.clear();

export const licensed = () => gateOverride.licensed ?? canRecordAudit();

/**
 * The project's name, slug and flag, cached for TTL_MS so a busy project costs
 * one query per half minute. A change on another replica is seen within that.
 * Lazy-loads the database: nothing here runs unless the licence already passed.
 */
export async function projectInfo(projectId: string): Promise<ProjectInfo | null> {
	const hit = cache.get(projectId);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.info;
	const { and, eq } = await import("drizzle-orm");
	const { db } = await import("../../db");
	const { projectSettingsEntity, projectsEntity } = await import("../../db/schema");
	const [row] = await db
		.select({
			name: projectsEntity.name,
			slug: projectsEntity.slug,
			enabled: projectSettingsEntity.value,
		})
		.from(projectsEntity)
		.leftJoin(
			projectSettingsEntity,
			and(
				eq(projectSettingsEntity.projectId, projectsEntity.id),
				eq(projectSettingsEntity.key, AUDIT_ENABLED_KEY),
			),
		)
		.where(eq(projectsEntity.id, projectId));
	// no setting row (a project from before audit logs) means off
	const info = row
		? { name: row.name ?? "", slug: row.slug, enabled: row.enabled === "true" }
		: null;
	cache.set(projectId, { at: Date.now(), info });
	return info;
}

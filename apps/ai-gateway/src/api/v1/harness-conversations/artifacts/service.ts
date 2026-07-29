import { ConflictError, NotFoundError } from "@fluxify/server";
import {
	findExistingRouteIds,
	getArtifactSubArtifacts,
	getSubArtifactById,
	listSubArtifactsByRun,
	markSubArtifactsApplied,
} from "./repository";

/** The subset of a sub-artifact row the dependency check reads. */
interface DependencyRow {
	id: string;
	kind: string;
	action: string | null;
	appliedAt: Date | null;
	payload: Record<string, any> | null;
}

/** The route a `kind: "route"` output creates or edits. */
const routeIdOf = (row: DependencyRow) => row.payload?.routeId as string | undefined;

/** The route a `kind: "canvas"` output hangs its blocks off. Canvases targeting a
 *  custom block have no route dependency, so they are not gated. */
const parentRouteIdOf = (row: DependencyRow) =>
	row.payload?.targetType === "route"
		? (row.payload?.targetId as string | undefined)
		: undefined;

/**
 * A canvas is meaningless without its route — its blocks hang off a route id, so
 * the route has to be live before the graph can be pushed.
 *
 * Two ways the dependency is satisfied: the route is a sibling output of the same
 * artifact (this run created it) and has already been applied, or it is an older
 * route that still exists in the project. `applyingRouteIds` are the siblings
 * being applied earlier in this same request.
 */
async function assertParentRoutesReady(
	projectId: string,
	canvases: DependencyRow[],
	siblings: DependencyRow[],
	applyingRouteIds: Set<string>,
) {
	const external: string[] = [];

	for (const routeId of new Set(
		canvases.map(parentRouteIdOf).filter((id): id is string => !!id),
	)) {
		if (applyingRouteIds.has(routeId)) continue;

		const sibling = siblings.find(
			(s) => s.kind === "route" && routeIdOf(s) === routeId,
		);
		if (!sibling) {
			external.push(routeId);
			continue;
		}
		if (!sibling.appliedAt) {
			throw new ConflictError(
				`These canvas changes belong to a route this run created that has not been applied yet. Apply the route (sub-artifact ${sibling.id}) first.`,
			);
		}
	}

	if (external.length === 0) return;
	const existing = await findExistingRouteIds(projectId, external);
	const missing = external.find((id) => !existing.has(id));
	if (missing) {
		throw new NotFoundError(
			`Route ${missing} was not found in this project, so its canvas changes cannot be applied. It may have been deleted — re-run the change to rebuild it.`,
		);
	}
}

export async function getSubArtifact(conversationId: string, subArtifactId: string) {
	const row = await getSubArtifactById(conversationId, subArtifactId);
	if (!row) throw new NotFoundError("Sub-artifact not found");
	return row;
}

export async function listRunSubArtifacts(conversationId: string, runId: string) {
	return { subArtifacts: await listSubArtifactsByRun(conversationId, runId) };
}

/**
 * Validates only, then stamps `applied_at`. The actual project mutation is owned
 * by `@fluxify/server` — the single source of truth for route/canvas writes.
 */
export async function applySubArtifact(
	conversationId: string,
	projectId: string,
	subArtifactId: string,
) {
	const row = await getSubArtifactById(conversationId, subArtifactId);
	if (!row) throw new NotFoundError("Sub-artifact not found");

	if (row.kind === "canvas") {
		const siblings = await getArtifactSubArtifacts(conversationId, row.artifactId);
		await assertParentRoutesReady(projectId, [row], siblings, new Set());
	}

	const [applied] = await markSubArtifactsApplied(
		conversationId,
		[subArtifactId],
		new Date(),
	);
	return applied;
}

/** Applies every output of one run's artifact in one shot. */
export async function applyArtifact(
	conversationId: string,
	projectId: string,
	artifactId: string,
) {
	const rows = await getArtifactSubArtifacts(conversationId, artifactId);
	if (rows.length === 0) throw new NotFoundError("Artifact not found");

	const routes = rows.filter((r) => r.kind === "route");
	const canvases = rows.filter((r) => r.kind === "canvas");
	const rest = rows.filter((r) => r.kind !== "route" && r.kind !== "canvas");

	// Routes go first, so a canvas referencing a route this run created is
	// already satisfied by the time its turn comes.
	const applyingRouteIds = new Set(
		routes.map(routeIdOf).filter((id): id is string => !!id),
	);
	await assertParentRoutesReady(projectId, canvases, routes, applyingRouteIds);

	const ordered = [...routes, ...canvases, ...rest];
	const appliedAt = new Date();
	await markSubArtifactsApplied(
		conversationId,
		ordered.map((r) => r.id),
		appliedAt,
	);

	return {
		artifactId,
		appliedAt,
		applied: ordered.map((r) => ({ id: r.id, kind: r.kind, action: r.action })),
	};
}

import { ConflictError, NotFoundError } from "@fluxify/server";
import type { RpcCaller } from "@fluxify/server/src/db/natsRpc";
import {
	canvasChangesFromPayload,
	routeOpFromPayload,
	type BlockBuilderPayload,
	type CanvasChanges,
	type CanvasItems,
	type RouteConfigPayload,
} from "./normalize";
import {
	callerFor,
	createRoute,
	deleteRoute,
	modifyRoute,
	readCanvas,
	saveCanvas,
} from "./opsClient";
import {
	findExistingRouteIds,
	getArtifactSubArtifacts,
	getSubArtifactById,
	listSubArtifactsByRun,
	markSubArtifactsApplied,
	updateSubArtifactPayload,
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

const EMPTY_CANVAS: CanvasItems = { blocks: [], edges: [] };

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

/**
 * The canvas agent copies `targetId` out of another agent's output, so a run can
 * end up with a canvas naming a route nobody created. When the id names neither
 * a live route nor a sibling output, and the run configured exactly one route,
 * that route is the only thing it can have meant — repair it rather than 404 on
 * an id the user never saw. The repair is persisted so later reads agree.
 */
async function resolveCanvasTarget<
	T extends { id: string; payload: Record<string, any> | null },
>(conversationId: string, projectId: string, row: T, siblings: DependencyRow[]) {
	const payload = row.payload ?? {};
	const targetId = payload.targetId as string | undefined;
	if (payload.targetType !== "route" || !targetId) return row;

	// Only an *applied* route is safe to adopt: an unapplied one leaves the case
	// where the canvas legitimately targeted an older route that has since been
	// deleted indistinguishable from a mis-copied id, and silently rebuilding
	// the graph on the wrong route is worse than refusing.
	const planned = siblings.filter(
		(s) =>
			s.kind === "route" &&
			s.appliedAt &&
			routeIdOf(s) &&
			s.payload?.action !== "delete",
	);
	if (planned.some((s) => routeIdOf(s) === targetId)) return row;
	if (planned.length !== 1) return row;

	const existing = await findExistingRouteIds(projectId, [targetId]);
	if (existing.has(targetId)) return row;

	const actual = routeIdOf(planned[0] as DependencyRow) as string;
	await updateSubArtifactPayload(conversationId, row.id, {
		...payload,
		targetId: actual,
	});
	return { ...row, payload: { ...payload, targetId: actual } };
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
 * The id the agent invented for a route it was creating is not the id storage
 * chose. Rewriting the payload keeps every later read — the artifact chips, the
 * `get_artifact` tool, the canvas dependency check — pointing at the live route.
 */
async function rememberRealRouteId(
	conversationId: string,
	row: { id: string; payload: Record<string, any> | null },
	field: "routeId" | "targetId",
	realId: string,
) {
	if (row.payload?.[field] === realId) return;
	await updateSubArtifactPayload(conversationId, row.id, {
		...(row.payload ?? {}),
		[field]: realId,
	});
}

type ApplyContext = {
	conversationId: string;
	projectId: string;
	caller: RpcCaller;
	/** the id the agent used for a route it created → the id storage gave it */
	routeIds: Map<string, string>;
};

/**
 * Writes one route output through the bus. `canvas` is sent inline on a create
 * so the route and its blocks land in one transaction — an approved plan that
 * half-applies leaves the user a route with no logic in it.
 */
async function applyRouteRow(
	ctx: ApplyContext,
	row: { id: string; payload: Record<string, any> | null },
	canvas?: CanvasChanges,
) {
	const payload = (row.payload ?? {}) as RouteConfigPayload;
	const op = routeOpFromPayload(payload, ctx.projectId);

	if (op.action === "delete") {
		await deleteRoute(ctx.caller, op.id);
		return;
	}
	if (op.action === "modify") {
		await modifyRoute(ctx.caller, op.id, op.data);
		return;
	}

	// Keep the id the run planned: the canvas output already names it, and every
	// link between the two outputs is that id.
	const { id } = await createRoute(ctx.caller, op.data, canvas, payload.routeId ?? undefined);
	if (payload.routeId) ctx.routeIds.set(payload.routeId, id);
	await rememberRealRouteId(ctx.conversationId, row, "routeId", id);
}

async function applyCanvasRow(
	ctx: ApplyContext,
	row: { id: string; payload: Record<string, any> | null },
) {
	const payload = (row.payload ?? {}) as BlockBuilderPayload;
	const source = payload.targetType ?? "route";
	const target = payload.targetId;
	if (!target) throw new NotFoundError("Canvas output has no target to apply to");

	const sourceId = ctx.routeIds.get(target) ?? target;
	// Normalizing needs the canvas as it stands: it decides which block ids are
	// already real and which edge is being re-routed.
	const existing = await readCanvas(ctx.caller, source, sourceId);
	await saveCanvas(
		ctx.caller,
		source,
		sourceId,
		canvasChangesFromPayload(payload, existing),
	);
	if (sourceId !== target) {
		await rememberRealRouteId(ctx.conversationId, row, "targetId", sourceId);
	}
}

/** Applies one output, then stamps `applied_at`. */
export async function applySubArtifact(
	userId: string,
	conversationId: string,
	projectId: string,
	subArtifactId: string,
) {
	const row = await getSubArtifactById(conversationId, subArtifactId);
	if (!row) throw new NotFoundError("Sub-artifact not found");

	const ctx: ApplyContext = {
		conversationId,
		projectId,
		caller: callerFor(userId, projectId),
		routeIds: new Map(),
	};

	if (row.kind === "canvas") {
		const siblings = await getArtifactSubArtifacts(conversationId, row.artifactId);
		const resolved = await resolveCanvasTarget(conversationId, projectId, row, siblings);
		await assertParentRoutesReady(projectId, [resolved], siblings, new Set());
		await applyCanvasRow(ctx, resolved);
	} else if (row.kind === "route") {
		const agentRouteId = row.payload?.routeId as string | undefined;
		await applyRouteRow(ctx, row);
		// The route now has the id storage chose, but its canvas siblings still
		// point at the id the agent invented. Leaving them stale breaks every
		// later read of the link — the apply gate cannot tell the route is live.
		const realId = agentRouteId ? ctx.routeIds.get(agentRouteId) : undefined;
		if (realId && agentRouteId !== realId) {
			const siblings = await getArtifactSubArtifacts(conversationId, row.artifactId);
			for (const sibling of siblings) {
				if (sibling.kind !== "canvas") continue;
				if (sibling.payload?.targetType !== "route") continue;
				if (sibling.payload?.targetId !== agentRouteId) continue;
				await rememberRealRouteId(conversationId, sibling, "targetId", realId);
			}
		}
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
	userId: string,
	conversationId: string,
	projectId: string,
	artifactId: string,
) {
	const rows = await getArtifactSubArtifacts(conversationId, artifactId);
	if (rows.length === 0) throw new NotFoundError("Artifact not found");

	const routes = rows.filter((r) => r.kind === "route");
	const canvases = await Promise.all(
		rows
			.filter((r) => r.kind === "canvas")
			.map((r) => resolveCanvasTarget(conversationId, projectId, r, rows)),
	);
	const rest = rows.filter((r) => r.kind !== "route" && r.kind !== "canvas");

	// Routes go first, so a canvas referencing a route this run created is
	// already satisfied by the time its turn comes.
	const applyingRouteIds = new Set(
		routes.map(routeIdOf).filter((id): id is string => !!id),
	);
	await assertParentRoutesReady(projectId, canvases, routes, applyingRouteIds);

	const ctx: ApplyContext = {
		conversationId,
		projectId,
		caller: callerFor(userId, projectId),
		routeIds: new Map(),
	};

	// A canvas for a route this run is creating rides along with the create, so
	// the route never exists without its blocks.
	const inlineCanvas = new Map<string, (typeof canvases)[number]>();
	const inlined = new Set<string>();
	for (const route of routes) {
		if (route.payload?.action !== "create") continue;
		const paired = canvases.find(
			(c) =>
				!inlined.has(c.id) &&
				c.payload?.targetType === "route" &&
				c.payload?.targetId === routeIdOf(route),
		);
		if (!paired) continue;
		inlineCanvas.set(route.id, paired);
		inlined.add(paired.id);
	}

	const ordered = [...routes, ...canvases, ...rest];
	const done: string[] = [];
	try {
		for (const route of routes) {
			const canvasRow = inlineCanvas.get(route.id);
			await applyRouteRow(
				ctx,
				route,
				canvasRow
					? canvasChangesFromPayload(
							(canvasRow.payload ?? {}) as BlockBuilderPayload,
							EMPTY_CANVAS,
						)
					: undefined,
			);
			done.push(route.id);
			if (canvasRow) {
				const real = ctx.routeIds.get(routeIdOf(route) ?? "");
				if (real)
					await rememberRealRouteId(conversationId, canvasRow, "targetId", real);
				done.push(canvasRow.id);
			}
		}
		for (const canvas of canvases) {
			if (inlined.has(canvas.id)) continue;
			await applyCanvasRow(ctx, canvas);
			done.push(canvas.id);
		}
		done.push(...rest.map((r) => r.id));
	} catch (error) {
		// Whatever landed is live; stamping it keeps a retry from redoing it.
		if (done.length > 0) await markSubArtifactsApplied(conversationId, done, new Date());
		throw error;
	}

	const appliedAt = new Date();
	await markSubArtifactsApplied(conversationId, done, appliedAt);

	return {
		artifactId,
		appliedAt,
		applied: ordered
			.filter((r) => done.includes(r.id))
			.map((r) => ({ id: r.id, kind: r.kind, action: r.action })),
	};
}

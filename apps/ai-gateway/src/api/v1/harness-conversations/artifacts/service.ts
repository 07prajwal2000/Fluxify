import { ConflictError, NotFoundError } from "@fluxify/server";
import { publishArtifactStatus } from "../../../../harness/notifications";
import type { ArtifactStatus } from "../../../../harness/clientContract";
import type { RpcCaller } from "@fluxify/server/src/db/natsRpc";
import {
	canvasChangesFromPayload,
	customBlockOpFromPayload,
	routeOpFromPayload,
	type BlockBuilderPayload,
	type CanvasChanges,
	type CanvasItems,
	type CustomBlockConfigPayload,
	type RouteConfigPayload,
} from "./normalize";
import {
	callerFor,
	createCustomBlock,
	createRoute,
	deleteCustomBlock,
	deleteRoute,
	modifyCustomBlock,
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
const customBlockIdOf = (row: DependencyRow) => row.payload?.customBlockId as string | undefined;

/** The route a `kind: "canvas"` output hangs its blocks off. Canvases targeting a
 *  custom block have no route dependency, so they are not gated. */
const parentRouteIdOf = (row: DependencyRow) =>
	row.payload?.targetType === "route"
		? (row.payload?.targetId as string | undefined)
		: undefined;

const EMPTY_CANVAS: CanvasItems = { blocks: [], edges: [] };

/** One output that did not land, and why. */
export interface ApplyFailure {
	id: string;
	kind: string;
	/** What the user would call the thing, e.g. `route "GET /orders/:id"`. */
	label: string;
	reason: string;
}

type LabelledRow = {
	id: string;
	kind: string;
	action?: string | null;
	payload: Record<string, any> | null;
};

const ACTION_VERBS: Record<string, string> = {
	add: "Created",
	create: "Created",
	delete: "Deleted",
	changes: "Updated",
	"update-partial": "Updated",
	modify: "Updated",
};

/**
 * What to call an output in something a human reads — a toast, or the reason a
 * retry is being suggested. Ids are meaningless to the user, and the run
 * already knows the route's method and path and the custom block's name.
 */
export function describeArtifactRow(row: LabelledRow): string {
	const payload = row.payload ?? {};
	if (row.kind === "route") {
		const method = (payload.data?.method ?? "").toString().toUpperCase();
		const path = payload.data?.path ?? "";
		const name = payload.data?.name;
		const target = [method, path].filter(Boolean).join(" ");
		if (name && target) return `route '${name}' (${target})`;
		return `route ${target ? `'${target}'` : row.id}`;
	}
	if (row.kind === "canvas") {
		const what = payload.targetType === "custom_block" ? "custom block" : "route";
		return `logic for the ${what}`;
	}
	return `${row.kind} ${row.id}`;
}

/** `Created route 'Get Order' (GET /orders/:id)` — the whole event, in words. */
export function describeArtifactEvent(row: LabelledRow): string {
	const verb = ACTION_VERBS[row.action ?? ""] ?? "Applied";
	return `${verb} ${describeArtifactRow(row)}`;
}

const LIFECYCLE: Record<string, ArtifactStatus["event"]> = {
	add: "created",
	create: "created",
	delete: "deleted",
};

/**
 * Tells the user what just changed in their project, in their words. Fires for
 * a manual apply and an auto-apply alike — from the user's side they are the
 * same thing happening, and the only place that knows the resolved name and
 * path is right here, where the payload is in hand.
 */
function announce(
	userId: string,
	conversationId: string,
	row: LabelledRow,
	failure?: ApplyFailure,
) {
	publishArtifactStatus(userId, {
		conversationId,
		subArtifactId: row.id,
		kind: row.kind,
		event: LIFECYCLE[row.action ?? ""] ?? "changed",
		outcome: failure ? "failed" : "applied",
		message: failure
			? `Could not apply the ${describeArtifactRow(row)}`
			: describeArtifactEvent(row),
		reason: failure?.reason,
		timestamp: Date.now(),
	});
}

function describeFailure(row: LabelledRow, error: unknown): ApplyFailure {
	return {
		id: row.id,
		kind: row.kind,
		label: describeArtifactRow(row),
		reason:
			typeof error === "string"
				? error
				: error instanceof Error
					? error.message
					: "Unknown error",
	};
}

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
	if (row.appliedAt) return row;
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
	field: "routeId" | "customBlockId" | "targetId",
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
	/** Planned custom-block id to storage id, same reconciliation as routes. */
	customBlockIds: Map<string, string>;
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

async function applyCustomBlockRow(
	ctx: ApplyContext,
	row: { id: string; payload: Record<string, any> | null },
	canvas?: CanvasChanges,
) {
	const payload = (row.payload ?? {}) as CustomBlockConfigPayload;
	const op = customBlockOpFromPayload(payload, ctx.projectId);
	if (op.action === "delete") {
		await deleteCustomBlock(ctx.caller, op.id);
		return;
	}
	if (op.action === "modify") {
		await modifyCustomBlock(ctx.caller, op.id, op.data);
		return;
	}
	const { id } = await createCustomBlock(ctx.caller, op.data, canvas);
	if (payload.customBlockId) ctx.customBlockIds.set(payload.customBlockId, id);
	await rememberRealRouteId(ctx.conversationId, row, "customBlockId", id);
}

async function applyCanvasRow(
	ctx: ApplyContext,
	row: { id: string; payload: Record<string, any> | null },
) {
	const payload = (row.payload ?? {}) as BlockBuilderPayload;
	const source = payload.targetType ?? "route";
	const target = payload.targetId;
	if (!target) throw new NotFoundError("Canvas output has no target to apply to");

	const sourceId = ctx.routeIds.get(target) ?? ctx.customBlockIds.get(target) ?? target;
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
		customBlockIds: new Map(),
	};

	if (row.kind === "canvas") {
		const siblings = await getArtifactSubArtifacts(conversationId, row.artifactId);
		const resolved = await resolveCanvasTarget(conversationId, projectId, row, siblings);
		await assertParentRoutesReady(projectId, [resolved], siblings, new Set());
		await applyCanvasRow(ctx, resolved);
	} else if (row.kind === "route") {
		const agentRouteId = row.payload?.routeId as string | undefined;
		const siblings = await getArtifactSubArtifacts(conversationId, row.artifactId);
		const canvasRow = row.payload?.action === "create"
			? siblings.find(
					(s) => s.kind === "canvas" && !s.appliedAt && s.payload?.targetType === "route" && s.payload?.targetId === agentRouteId,
				)
			: undefined;
		await applyRouteRow(
			ctx,
			row,
			canvasRow ? canvasChangesFromPayload((canvasRow.payload ?? {}) as BlockBuilderPayload, EMPTY_CANVAS) : undefined,
		);
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
	} else if (row.kind === "custom_block") {
		const agentCustomBlockId = row.payload?.customBlockId as string | undefined;
		const siblings = await getArtifactSubArtifacts(conversationId, row.artifactId);
		const canvasRow = row.payload?.action === "create"
			? siblings.find(
					(s) =>
						s.kind === "canvas" &&
						!s.appliedAt &&
						s.payload?.targetType === "custom_block" &&
						s.payload?.targetId === agentCustomBlockId,
				)
			: undefined;
		await applyCustomBlockRow(
			ctx,
			row,
			canvasRow
				? canvasChangesFromPayload((canvasRow.payload ?? {}) as BlockBuilderPayload, EMPTY_CANVAS)
				: undefined,
		);
		const realId = agentCustomBlockId ? ctx.customBlockIds.get(agentCustomBlockId) : undefined;
		if (realId && agentCustomBlockId !== realId) {
			for (const sibling of siblings) {
				if (sibling.kind !== "canvas") continue;
				if (sibling.payload?.targetType !== "custom_block") continue;
				if (sibling.payload?.targetId !== agentCustomBlockId) continue;
				await rememberRealRouteId(conversationId, sibling, "targetId", realId);
			}
		}
		if (canvasRow) await markSubArtifactsApplied(conversationId, [canvasRow.id], new Date());
	}

	const [applied] = await markSubArtifactsApplied(
		conversationId,
		[subArtifactId],
		new Date(),
	);
	announce(userId, conversationId, row);
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
	const customBlocks = rows.filter((r) => r.kind === "custom_block");
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
		customBlockIds: new Map(),
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
	for (const customBlock of customBlocks) {
		if (customBlock.payload?.action !== "create") continue;
		const paired = canvases.find(
			(c) => !inlined.has(c.id) && c.payload?.targetType === "custom_block" && c.payload?.targetId === customBlockIdOf(customBlock),
		);
		if (!paired) continue;
		inlineCanvas.set(customBlock.id, paired);
		inlined.add(paired.id);
	}

	const ordered = [...routes, ...customBlocks, ...canvases, ...rest];
	const done: string[] = [];
	// One bad output used to abort the whole batch, so a run that got nine
	// things right and one wrong left the user with nine unapplied outputs and
	// no idea which one was the problem. Each output is applied on its own now;
	// what fails stays unapplied and re-appliable, and is named in the result.
	const failures: ApplyFailure[] = [];
	/** Routes that did not land — their canvases have nothing to attach to. */
	const failedRouteIds = new Set<string>();

	for (const route of routes) {
		const canvasRow = inlineCanvas.get(route.id);
		try {
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
		} catch (error) {
			const routeId = routeIdOf(route);
			if (routeId) failedRouteIds.add(routeId);
			failures.push(describeFailure(route, error));
			// The canvas rode along inside the create, so it did not land either.
			if (canvasRow) {
				failures.push(
					describeFailure(canvasRow, "its route could not be created"),
				);
			}
		}
	}

	for (const customBlock of customBlocks) {
			const canvasRow = inlineCanvas.get(customBlock.id);
			try {
				await applyCustomBlockRow(
					ctx,
					customBlock,
					canvasRow
						? canvasChangesFromPayload(
								(canvasRow.payload ?? {}) as BlockBuilderPayload,
								EMPTY_CANVAS,
							)
						: undefined,
				);
				done.push(customBlock.id);
				if (canvasRow) {
					const real = ctx.customBlockIds.get(customBlockIdOf(customBlock) ?? "");
					if (real)
						await rememberRealRouteId(conversationId, canvasRow, "targetId", real);
					done.push(canvasRow.id);
				}
			} catch (error) {
				failures.push(describeFailure(customBlock, error));
				if (canvasRow)
					failures.push(
						describeFailure(canvasRow, "its custom block could not be created"),
					);
			}
		}

	for (const canvas of canvases) {
		if (inlined.has(canvas.id)) continue;
		const parentRouteId = parentRouteIdOf(canvas as DependencyRow);
		if (parentRouteId && failedRouteIds.has(parentRouteId)) {
			failures.push(describeFailure(canvas, "its route could not be created"));
			continue;
		}
		try {
			await applyCanvasRow(ctx, canvas);
			done.push(canvas.id);
		} catch (error) {
			failures.push(describeFailure(canvas, error));
		}
	}
	done.push(...rest.map((r) => r.id));

	const appliedAt = new Date();
	if (done.length > 0) await markSubArtifactsApplied(conversationId, done, appliedAt);

	const failedById = new Map(failures.map((f) => [f.id, f]));
	for (const row of ordered) {
		const failure = failedById.get(row.id);
		if (!failure && !done.includes(row.id)) continue;
		announce(userId, conversationId, row, failure);
	}

	return {
		artifactId,
		appliedAt,
		applied: ordered
			.filter((r) => done.includes(r.id))
			.map((r) => ({ id: r.id, kind: r.kind, action: r.action })),
		failed: failures,
	};
}

import { ConflictError, NotFoundError } from "@fluxify/server";
import { withCustomBlockPrefix } from "@fluxify/lib";
import { publishArtifactStatus } from "../../../../harness/notifications";
import type { ArtifactStatus } from "../../../../harness/clientContract";
import type { RpcCaller } from "@fluxify/server/src/db/natsRpc";
import {
	formattedCanvasChanges,
	customBlockOpFromPayload,
	remapCustomBlockNames,
	routeOpFromPayload,
	type BlockBuilderPayload,
	type CanvasChanges,
	type CanvasItems,
	type CustomBlockConfigPayload,
	type RouteConfigPayload,
} from "./normalize";
import {
	inlineCanvasFor,
	kindLabel,
	parentsOf,
	referencedIdOf,
} from "./dependencies";
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
export interface DependencyRow {
	id: string;
	kind: string;
	action: string | null;
	appliedAt: Date | null;
	payload: Record<string, any> | null;
	subAgentId?: string | null;
	dependsOn?: string[] | null;
}

/** The route a `kind: "route"` output creates or edits. */
export const routeIdOf = (row: DependencyRow) => row.payload?.routeId as string | undefined;
export const customBlockIdOf = (row: DependencyRow) => row.payload?.customBlockId as string | undefined;

/** The route a `kind: "canvas"` output hangs its blocks off. Canvases targeting a
 *  custom block have no route dependency, so they are not gated. */
export const parentRouteIdOf = (row: DependencyRow) =>
	row.payload?.targetType === "route"
		? (row.payload?.targetId as string | undefined)
		: undefined;

export const EMPTY_CANVAS: CanvasItems = { blocks: [], edges: [] };

/** One output that did not land, and why. */
export interface ApplyFailure {
	id: string;
	kind: string;
	/** What the user would call the thing, e.g. `route "GET /orders/:id"`. */
	label: string;
	reason: string;
}

export type LabelledRow = {
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
	if (row.kind === "custom_block") {
		const name = payload.data?.label ?? payload.data?.name;
		return name ? `custom block '${name}'` : `custom block ${row.id}`;
	}
	return `${kindLabel(row.kind)} ${row.id}`;
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
export function announce(
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

export function describeFailure(row: LabelledRow, error: unknown): ApplyFailure {
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
 * The parent of `row` that is not live yet, if there is one.
 *
 * Applying a child before its parent produces a resource that cannot execute —
 * a route invoking a custom block that does not exist, a canvas hanging off a
 * route that was never created. Nothing here knows which kinds those are; the
 * edge comes from the run's own task graph.
 *
 * `applying` are siblings this same request is about to apply earlier in the
 * order, which satisfies the dependency just as an already-applied row does.
 */
export function unappliedParent(
	row: DependencyRow,
	siblings: DependencyRow[],
	applying: ReadonlySet<string> = new Set(),
): DependencyRow | undefined {
	return parentsOf(row, siblings).find(
		(parent) => !parent.appliedAt && !applying.has(parent.id),
	);
}

/**
 * Refuses a child whose parent has not been applied, naming the parent.
 *
 * Deliberately not a cascade-apply: creating a resource in the user's project
 * because they clicked a different one is a surprise they cannot undo. Block,
 * say what to apply first, and let them press it.
 */
export function assertParentsApplied(
	row: DependencyRow,
	siblings: DependencyRow[],
	applying?: ReadonlySet<string>,
) {
	const parent = unappliedParent(row, siblings, applying);
	if (!parent) return;
	throw new ConflictError(
		`This ${kindLabel(row.kind)} output depends on the ${describeArtifactRow(
			parent,
		)} this run created, which has not been applied yet. Apply it (sub-artifact ${
			parent.id
		}) first.`,
	);
}

/**
 * Referential check, not a dependency one: a canvas may legitimately target a
 * route from an earlier run, and if that route has since been deleted the save
 * fails deep in the canvas service with a message about a parent id the user
 * never saw. Rows created *this* run are handled by the dependency gate above.
 */
export async function assertExternalRoutesExist(
	projectId: string,
	canvases: DependencyRow[],
	siblings: DependencyRow[],
) {
	const external = [
		...new Set(canvases.map(parentRouteIdOf).filter((id): id is string => !!id)),
	].filter(
		(routeId) => !siblings.some((s) => s.kind === "route" && routeIdOf(s) === routeId),
	);
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
export async function resolveCanvasTarget<
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
export async function rememberRealRouteId(
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

export type ApplyContext = {
	conversationId: string;
	projectId: string;
	caller: RpcCaller;
	/** the id the agent used for a route it created → the id storage gave it */
	routeIds: Map<string, string>;
	/** Planned custom-block id to storage id, same reconciliation as routes. */
	customBlockIds: Map<string, string>;
	/** The name a custom block was created under, when storage did not use the
	 *  one the run asked for. Canvases invoke a block by name, so a canvas built
	 *  against the requested name has to be rewritten before it is saved. */
	customBlockNames: Map<string, string>;
};

export const newApplyContext = (
	conversationId: string,
	projectId: string,
	userId: string,
): ApplyContext => ({
	conversationId,
	projectId,
	caller: callerFor(userId, projectId),
	routeIds: new Map(),
	customBlockIds: new Map(),
	customBlockNames: new Map(),
});

/**
 * Writes one route output through the bus. `canvas` is sent inline on a create
 * so the route and its blocks land in one transaction — an approved plan that
 * half-applies leaves the user a route with no logic in it.
 */
export async function applyRouteRow(
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

export async function applyCustomBlockRow(
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
	// Storage namespaces a project block, so the name a caller's canvas has to
	// invoke is not the bare one this payload asked for. Recorded before the
	// create so an inlined canvas in the same call is rewritten too.
	ctx.customBlockNames.set(op.data.name, withCustomBlockPrefix(op.data.name));
	const { id } = await createCustomBlock(ctx.caller, op.data, canvas);
	if (payload.customBlockId) ctx.customBlockIds.set(payload.customBlockId, id);
	await rememberRealRouteId(ctx.conversationId, row, "customBlockId", id);
}

/**
 * One canvas payload, ready for the bus. Every path that pushes a graph goes
 * through here so the name remap cannot be forgotten on one of them — a canvas
 * saved with a stale `custom:<name>` looks fine and resolves to nothing.
 */
export function canvasFor(
	ctx: ApplyContext,
	row: { payload: Record<string, any> | null },
	existing: CanvasItems,
) {
	return formattedCanvasChanges(
		remapCustomBlockNames(
			(row.payload ?? {}) as BlockBuilderPayload,
			ctx.customBlockNames,
		),
		existing,
	);
}

export async function applyCanvasRow(
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
	await saveCanvas(ctx.caller, source, sourceId, await canvasFor(ctx, row, existing));
	if (sourceId !== target) {
		await rememberRealRouteId(ctx.conversationId, row, "targetId", sourceId);
	}
}

/** How each kind is written to the project. Ordering, pairing and gating are
 *  kind-agnostic; only the write itself knows what it is writing. */
export const APPLY_BY_KIND: Record<
	string,
	(
		ctx: ApplyContext,
		row: { id: string; payload: Record<string, any> | null },
		canvas?: CanvasChanges,
	) => Promise<void>
> = {
	route: applyRouteRow,
	custom_block: applyCustomBlockRow,
	canvas: applyCanvasRow,
};

/**
 * The parent has the id storage chose; its children still name the one the
 * agent invented. Leaving them stale breaks every later read of the link — the
 * apply gate cannot tell the parent is live.
 */
export async function rememberRealIdsOnChildren(
	ctx: ApplyContext,
	rows: { id: string; payload: Record<string, any> | null }[],
) {
	for (const row of rows) {
		const planned = referencedIdOf(row);
		if (!planned) continue;
		const real = ctx.routeIds.get(planned) ?? ctx.customBlockIds.get(planned);
		if (real && real !== planned)
			await rememberRealRouteId(ctx.conversationId, row, "targetId", real);
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
	// A route create may already have landed its paired canvas inline. Retrying
	// that canvas must not generate a second set of block ids and save it again.
	if (row.appliedAt) return row;

	const ctx = newApplyContext(conversationId, projectId, userId);
	const siblings = await getArtifactSubArtifacts(conversationId, row.artifactId);
	// A no-op unless this is a canvas whose target was mis-copied, but it has to
	// run before the graph is read: every edge into this row goes through the id
	// it repairs.
	const resolved = await resolveCanvasTarget(conversationId, projectId, row, siblings);
	const rows = siblings.map((s) => (s.id === resolved.id ? { ...s, ...resolved } : s));

	assertParentsApplied(resolved as DependencyRow, rows);
	await assertExternalRoutesExist(projectId, [resolved as DependencyRow], rows);

	const apply = APPLY_BY_KIND[resolved.kind];
	if (apply) {
		// An already-applied canvas must not ride along a second time.
		const child = inlineCanvasFor(
			resolved as DependencyRow,
			rows,
			new Set(rows.filter((s) => s.appliedAt).map((s) => s.id)),
		);
		await apply(
			ctx,
			resolved,
			child ? await canvasFor(ctx, child, EMPTY_CANVAS) : undefined,
		);
		await rememberRealIdsOnChildren(ctx, rows);
		// The canvas rode inside the create, so it is live. Leaving it unstamped
		// showed it as pending and let a second apply re-save the same blocks.
		if (child) await markSubArtifactsApplied(conversationId, [child.id], new Date());
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

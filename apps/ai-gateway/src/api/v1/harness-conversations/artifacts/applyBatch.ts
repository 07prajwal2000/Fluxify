import { NotFoundError } from "@fluxify/server";
import {
	canvasChangesFromPayload,
	type BlockBuilderPayload,
} from "./normalize";
import { callerFor } from "./opsClient";
import {
	getArtifactSubArtifacts,
	markSubArtifactsApplied,
} from "./repository";
import {
	announce,
	applyCanvasRow,
	applyCustomBlockRow,
	applyRouteRow,
	assertParentRoutesReady,
	customBlockIdOf,
	describeFailure,
	EMPTY_CANVAS,
	parentRouteIdOf,
	rememberRealRouteId,
	resolveCanvasTarget,
	routeIdOf,
	type ApplyContext,
	type ApplyFailure,
	type DependencyRow,
	type LabelledRow,
} from "./service";

/**
 * Pairs each newly-created parent row with the canvas built for it in the same
 * run, so the canvas rides inside the create and the parent never exists
 * without its blocks. Routes and custom blocks differ only in how their id is
 * read off the payload.
 */
function pairInlineCanvases<R extends { id: string; payload?: any }, C extends { id: string; payload?: any }>(
	parents: R[],
	canvases: C[],
	targetType: "route" | "custom_block",
	idOf: (row: R) => string | undefined,
	inlineCanvas: Map<string, C>,
	inlined: Set<string>,
) {
	for (const parent of parents) {
		if (parent.payload?.action !== "create") continue;
		const paired = canvases.find(
			(c) =>
				!inlined.has(c.id) &&
				c.payload?.targetType === targetType &&
				c.payload?.targetId === idOf(parent),
		);
		if (!paired) continue;
		inlineCanvas.set(parent.id, paired);
		inlined.add(paired.id);
	}
}

/**
 * Applies every route (or custom block) row, each on its own so one bad output
 * cannot abort the batch. Both kinds follow the identical shape: apply the
 * parent with its inlined canvas, record the real id the DB handed back onto
 * that canvas, and on failure mark the pair unapplied and re-appliable.
 */
async function applyParentRows<R extends LabelledRow & { payload?: any }, C extends LabelledRow & { payload?: any }>(
	ctx: ApplyContext,
	parents: R[],
	opts: {
		inlineCanvas: Map<string, C>;
		apply: (ctx: ApplyContext, row: R, changes?: any) => Promise<unknown>;
		idOf: (row: R) => string | undefined;
		realIds: Map<string, string>;
		pairedFailure: string;
		onFailure?: (id: string) => void;
		done: string[];
		failures: ApplyFailure[];
		conversationId: string;
	},
) {
	for (const parent of parents) {
		const canvasRow = opts.inlineCanvas.get(parent.id);
		try {
			await opts.apply(
				ctx,
				parent,
				canvasRow
					? canvasChangesFromPayload(
							(canvasRow.payload ?? {}) as BlockBuilderPayload,
							EMPTY_CANVAS,
						)
					: undefined,
			);
			opts.done.push(parent.id);
			if (canvasRow) {
				const real = opts.realIds.get(opts.idOf(parent) ?? "");
				if (real)
					await rememberRealRouteId(
						opts.conversationId,
						canvasRow,
						"targetId",
						real,
					);
				opts.done.push(canvasRow.id);
			}
		} catch (error) {
			const id = opts.idOf(parent);
			if (id) opts.onFailure?.(id);
			opts.failures.push(describeFailure(parent, error));
			// The canvas rode along inside the create, so it did not land either.
			if (canvasRow)
				opts.failures.push(describeFailure(canvasRow, opts.pairedFailure));
		}
	}
}

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
	// `rest` is stamped applied unconditionally at the end, so every kind that
	// has its own apply path must be excluded — a custom block left in here was
	// marked applied even when its create had just failed.
	const rest = rows.filter(
		(r) => r.kind !== "route" && r.kind !== "canvas" && r.kind !== "custom_block",
	);

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
	pairInlineCanvases(routes, canvases, "route", routeIdOf, inlineCanvas, inlined);
	pairInlineCanvases(
		customBlocks,
		canvases,
		"custom_block",
		customBlockIdOf,
		inlineCanvas,
		inlined,
	);

	const ordered = [...routes, ...customBlocks, ...canvases, ...rest];
	const done: string[] = [];
	// One bad output used to abort the whole batch, so a run that got nine
	// things right and one wrong left the user with nine unapplied outputs and
	// no idea which one was the problem. Each output is applied on its own now;
	// what fails stays unapplied and re-appliable, and is named in the result.
	const failures: ApplyFailure[] = [];
	/** Routes that did not land — their canvases have nothing to attach to. */
	const failedRouteIds = new Set<string>();

	await applyParentRows(ctx, routes, {
		inlineCanvas,
		apply: applyRouteRow,
		idOf: routeIdOf,
		realIds: ctx.routeIds,
		pairedFailure: "its route could not be created",
		// A canvas whose route never landed has nothing to attach to.
		onFailure: (id) => failedRouteIds.add(id),
		done,
		failures,
		conversationId,
	});
	await applyParentRows(ctx, customBlocks, {
		inlineCanvas,
		apply: applyCustomBlockRow,
		idOf: customBlockIdOf,
		realIds: ctx.customBlockIds,
		pairedFailure: "its custom block could not be created",
		done,
		failures,
		conversationId,
	});

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

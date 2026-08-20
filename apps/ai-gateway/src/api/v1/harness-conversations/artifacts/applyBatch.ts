import { NotFoundError } from "@fluxify/server";
import {
	inlineCanvasFor,
	kindLabel,
	parentsOf,
	topoOrder,
	type GraphRow,
} from "./dependencies";
import { callerFor } from "./opsClient";
import {
	getArtifactSubArtifacts,
	markSubArtifactsApplied,
} from "./repository";
import {
	announce,
	APPLY_BY_KIND,
	assertExternalRoutesExist,
	canvasFor,
	describeFailure,
	EMPTY_CANVAS,
	newApplyContext,
	rememberRealIdsOnChildren,
	resolveCanvasTarget,
	type ApplyFailure,
	type DependencyRow,
} from "./service";

export async function applyArtifact(
	userId: string,
	conversationId: string,
	projectId: string,
	artifactId: string,
) {
	const raw = await getArtifactSubArtifacts(conversationId, artifactId);
	if (raw.length === 0) throw new NotFoundError("Artifact not found");

	// The target repair has to happen before the graph is read: the id it fixes
	// is the edge between a canvas and the parent it hangs off.
	const rows = await Promise.all(
		raw.map((row) => resolveCanvasTarget(conversationId, projectId, row, raw)),
	);
	await assertExternalRoutesExist(
		projectId,
		rows.filter((r) => r.kind === "canvas") as DependencyRow[],
		rows as DependencyRow[],
	);

	// A canvas for a parent this run is creating rides along with the create, so
	// the parent never exists without its blocks — it is applied there, not in
	// its own turn.
	const inlined = new Set<string>();
	const inlineCanvas = new Map<string, (typeof rows)[number]>();
	for (const row of rows) {
		const child = inlineCanvasFor(row as GraphRow, rows as GraphRow[], inlined);
		if (!child) continue;
		inlineCanvas.set(row.id, child as (typeof rows)[number]);
		inlined.add(child.id);
	}

	// The run's own DAG decides the order. Every relationship — a canvas needing
	// its route, a route invoking a custom block created alongside it — is the
	// same edge, so none of them is hardcoded here.
	const ordered = topoOrder(rows as GraphRow[]) as typeof rows;

	const ctx = newApplyContext(conversationId, projectId, userId);
	const done: string[] = [];
	// One bad output used to abort the whole batch, so a run that got nine
	// things right and one wrong left the user with nine unapplied outputs and
	// no idea which one was the problem. Each output is applied on its own now;
	// what fails stays unapplied and re-appliable, and is named in the result.
	const failures: ApplyFailure[] = [];
	/** Rows that did not land, so anything hanging off them cannot either. */
	const failed = new Map<string, (typeof rows)[number]>();

	for (const row of ordered) {
		if (inlined.has(row.id)) continue;

		// Cascade, in dependency order: a parent that failed is already in here by
		// the time its children come round, and a skipped child is added itself,
		// so the skip carries down a chain of any length.
		const brokenParent = parentsOf(row as GraphRow, rows as GraphRow[]).find((p) =>
			failed.has(p.id),
		);
		if (brokenParent) {
			const reason = `its ${kindLabel(brokenParent.kind)} could not be created`;
			failures.push(describeFailure(row, reason));
			failed.set(row.id, row);
			const child = inlineCanvas.get(row.id);
			if (child) failures.push(describeFailure(child, reason));
			continue;
		}

		const child = inlineCanvas.get(row.id);
		const apply = APPLY_BY_KIND[row.kind];
		if (!apply) {
			done.push(row.id);
			continue;
		}

		try {
			await apply(
				ctx,
				row,
				child ? await canvasFor(ctx, child, EMPTY_CANVAS) : undefined,
			);
			done.push(row.id);
			if (child) {
				await rememberRealIdsOnChildren(ctx, [child]);
				done.push(child.id);
			}
		} catch (error) {
			failed.set(row.id, row);
			failures.push(describeFailure(row, error));
			// The canvas rode along inside the create, so it did not land either.
			if (child)
				failures.push(
					describeFailure(child, `its ${kindLabel(row.kind)} could not be created`),
				);
		}
	}

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

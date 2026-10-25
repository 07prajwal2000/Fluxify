import { eq } from "drizzle-orm";
import type { z } from "zod";
import { routeConflictError } from "../../api/v1/routes/routeConflict";
import { findRouteConflict } from "../../api/v1/routes/update/repository";
import { type DbTransactionType, db } from "../../db";
import type { AuthACL, CanvasSnapshot, CanvasVersionKind } from "../../db/schema";
import { ConflictError } from "../../errors/conflictError";
import { ForbiddenError } from "../../errors/forbidError";
import { NotFoundError } from "../../errors/notFoundError";
import { canAccessProject } from "../../lib/acl";
import { audit } from "../audit";
import type { checkoutBodySchema, commitBodySchema } from "./dto";
import {
	findAuthor,
	findVersion,
	insertVersion,
	listVersions,
	nextVersionNumber,
	ownerOf,
	readTarget,
	targetTable,
} from "./repository";
import { buildSnapshot, restoreSnapshot } from "./snapshot";
import { hasUncommitted } from "./state";
import { announceChange, NOT_FOUND } from "./targets";

/** * Commit and checkout (#738, #740). Both hold the target's row lock for the
 * whole transaction, so version numbers never clash and two checkouts never
 * interleave. Neither compiles or deploys anything: commit changes no live
 * state, and checkout only announces the working copy it changed.
 */

/** what a checkout could not put back, by kind */
const SKIPPED = {
	route: "middleware(s) from that version no longer exist and were not attached.",
	workflow: "item(s) from that version no longer exist and were not restored.",
	custom_block: "item(s) from that version no longer exist and were not restored.",
	middleware: "block(s) from that version no longer exist and were not added to the chain.",
} as const;
type Target = NonNullable<Awaited<ReturnType<typeof readTarget>>>;
type VersionRow = NonNullable<Awaited<ReturnType<typeof findVersion>>>;

/** A version as the API returns it. */
function present(
	row: Omit<VersionRow, "snapshot"> & { snapshot?: unknown },
	headId: string | null,
	prodId: string | null,
) {
	return {
		id: row.id,
		kind: row.kind,
		targetId: ownerOf(row),
		versionNumber: row.versionNumber,
		title: row.title,
		description: row.description,
		author: row.authorName ?? row.authorEmail,
		authorEmail: row.authorEmail,
		createdAt: row.createdAt.toISOString(),
		parentId: row.parentId,
		isHead: row.id === headId,
		/** the version production serves (#739) */
		isProd: row.id === prodId,
	};
}

async function accessTarget(
	kind: CanvasVersionKind,
	id: string,
	acl: AuthACL[],
	role: "viewer" | "creator",
	tx?: DbTransactionType,
	lock = false,
): Promise<Target> {
	const target = await readTarget(kind, id, tx, lock);
	if (!target) throw new NotFoundError(NOT_FOUND[kind]);
	if (!canAccessProject(acl, target.projectId!, role)) throw new ForbiddenError();
	return target;
}

/** Stores the working copy as the next version and makes it the head. */
async function writeVersion(
	kind: CanvasVersionKind,
	target: Target,
	input: z.infer<typeof commitBodySchema>,
	userId: string | undefined,
	tx: DbTransactionType,
) {
	const author = await findAuthor(userId, tx);
	const created = await insertVersion(
		{
			kind,
			targetId: target.id,
			projectId: target.projectId!,
			versionNumber: await nextVersionNumber(kind, target.id, tx),
			parentId: target.headVersionId,
			title: input.title,
			description: input.description ?? null,
			authorId: author?.id ?? null,
			authorEmail: author?.email ?? null,
			snapshot: await buildSnapshot(kind, target.id, tx),
		},
		tx,
	);
	const table = targetTable(kind);
	await tx
		.update(table)
		.set({
			headVersionId: created.id,
			committedRevision: target.canvasRevision,
			// a commit is not an edit: the list of "last edited" stays as it was
			updatedAt: table.updatedAt,
		})
		.where(eq(table.id, target.id));
	return created;
}

export async function commitVersion(
	kind: CanvasVersionKind,
	id: string,
	input: z.infer<typeof commitBodySchema>,
	userId: string | undefined,
	acl: AuthACL[],
) {
	return await db.transaction(async (tx) => {
		const target = await accessTarget(kind, id, acl, "creator", tx, true);
		if (!hasUncommitted(target)) throw new ConflictError("Nothing to commit");
		const created = await writeVersion(kind, target, input, userId, tx);
		await audit.record({
			projectId: target.projectId,
			resourceType: kind,
			resourceId: id,
			action: "commit",
			changedFields: ["version"],
		});
		return present({ ...created, authorName: null }, created.id, target.prodVersionId);
	});
}

export async function checkoutVersion(
	kind: CanvasVersionKind,
	id: string,
	versionId: string,
	input: z.infer<typeof checkoutBodySchema>,
	userId: string | undefined,
	acl: AuthACL[],
) {
	const outcome = await db.transaction(async (tx) => {
		const target = await accessTarget(kind, id, acl, "creator", tx, true);
		const version = await findVersion(kind, id, versionId, tx);
		if (!version) throw new NotFoundError("Version not found");
		const uncommitted = hasUncommitted(target);
		const checkedOut = present(version, version.id, target.prodVersionId);
		if (!uncommitted && target.headVersionId === version.id) {
			return {
				checkedOut,
				canvasRevision: target.canvasRevision,
				warnings: [],
				changed: false,
				projectId: undefined,
			};
		}

		// refused before anything is written, so a clash saves nothing either
		if (kind === "route") {
			await assertNoPathClash(target, (version.snapshot as CanvasSnapshot).settings, tx);
		}

		const saved = uncommitted
			? await writeVersion(
					kind,
					target,
					{ title: input.title ?? `Saved before checking out v${version.versionNumber}` },
					userId,
					tx,
				)
			: undefined;
		const skipped = await restoreSnapshot(kind, target, version.snapshot, tx);

		const canvasRevision = target.canvasRevision + 1;
		const table = targetTable(kind);
		await tx
			.update(table)
			.set({ canvasRevision, committedRevision: canvasRevision, headVersionId: version.id })
			.where(eq(table.id, id));
		await audit.record({
			projectId: target.projectId,
			resourceType: kind,
			resourceId: id,
			action: "checkout",
			changedFields: ["version"],
		});
		return {
			savedVersion: saved
				? present({ ...saved, authorName: null }, null, target.prodVersionId)
				: undefined,
			checkedOut,
			canvasRevision,
			warnings: skipped.length ? [`${skipped.length} ${SKIPPED[kind]}`] : [],
			changed: true,
			projectId: target.projectId!,
		};
	});

	const { changed, projectId, ...result } = outcome;
	// the usual change signal, so development recompiles the restored canvas
	if (changed && projectId) await announceChange(kind, id, projectId);
	// the development spec lists the route's response schemas, which a checkout just replaced
	if (changed && projectId && kind === "route") {
		const { invalidateOpenApiCache } = await import("../../api/v1/routes/openapi/service");
		await invalidateOpenApiCache(projectId, "development");
	}
	return result;
}

/** The restored path and method must not be another route's. */
async function assertNoPathClash(
	target: Target,
	settings: { path?: string | null; method?: string | null },
	tx: DbTransactionType,
) {
	if (!settings.path || !settings.method) return;
	const wanted = {
		projectId: target.projectId!,
		name: target.name ?? "",
		path: settings.path,
		method: settings.method,
	};
	const clash = await findRouteConflict(wanted, target.id, tx);
	if (clash) throw routeConflictError(clash, wanted);
}

export async function listTargetVersions(kind: CanvasVersionKind, id: string, acl: AuthACL[]) {
	const target = await accessTarget(kind, id, acl, "viewer");
	const rows = await listVersions(kind, id);
	return {
		versions: rows.map((row) => present(row, target.headVersionId, target.prodVersionId)),
		uncommitted: hasUncommitted(target),
	};
}

export async function getTargetVersion(
	kind: CanvasVersionKind,
	id: string,
	versionId: string,
	acl: AuthACL[],
) {
	const target = await accessTarget(kind, id, acl, "viewer");
	const version = await findVersion(kind, id, versionId);
	if (!version) throw new NotFoundError("Version not found");
	return {
		...present(version, target.headVersionId, target.prodVersionId),
		snapshot: version.snapshot,
	};
}

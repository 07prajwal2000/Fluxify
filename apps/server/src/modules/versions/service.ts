import { eq } from "drizzle-orm";
import type { z } from "zod";
import { routeConflictError } from "../../api/v1/routes/routeConflict";
import { findRouteConflict } from "../../api/v1/routes/update/repository";
import { type DbTransactionType, db } from "../../db";
import { systemUsers } from "../../db/auth-schema";
import { CHAN_ON_ROUTE_CHANGE, CHAN_ON_WORKFLOW_CHANGE, publishMessage } from "../../db/redis";
import type { AuthACL, CanvasVersionKind } from "../../db/schema";
import { ConflictError } from "../../errors/conflictError";
import { ForbiddenError } from "../../errors/forbidError";
import { NotFoundError } from "../../errors/notFoundError";
import { canAccessProject } from "../../lib/acl";
import type { checkoutBodySchema, commitBodySchema } from "./dto";
import {
	findVersion,
	insertVersion,
	listVersions,
	nextVersionNumber,
	readTarget,
	targetTable,
} from "./repository";
import { buildSnapshot, restoreSnapshot } from "./snapshot";
import { hasUncommitted } from "./state";

/**
 * Commit and checkout (#738). Both hold the route's or workflow's row lock for
 * the whole transaction, so version numbers never clash and two checkouts never
 * interleave. Neither compiles or deploys anything: commit changes no live
 * state, and checkout only announces the working copy it changed.
 */

const NOT_FOUND = { route: "Route not found", workflow: "Workflow not found" } as const;
const CHANGE_CHANNEL = { route: CHAN_ON_ROUTE_CHANGE, workflow: CHAN_ON_WORKFLOW_CHANGE } as const;

type Target = NonNullable<Awaited<ReturnType<typeof readTarget>>>;
type VersionRow = NonNullable<Awaited<ReturnType<typeof findVersion>>>;

/** A version as the API returns it. */
function present(
	row: Omit<VersionRow, "snapshot"> & { snapshot?: unknown },
	headId: string | null,
) {
	return {
		id: row.id,
		kind: row.kind,
		targetId: (row.routeId ?? row.workflowId)!,
		versionNumber: row.versionNumber,
		title: row.title,
		description: row.description,
		author: row.authorName ?? row.authorEmail,
		authorEmail: row.authorEmail,
		createdAt: row.createdAt.toISOString(),
		parentId: row.parentId,
		isHead: row.id === headId,
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
	const [author] = userId
		? await tx
				.select({ id: systemUsers.id, email: systemUsers.email })
				.from(systemUsers)
				.where(eq(systemUsers.id, userId))
		: [];
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
		return present({ ...created, authorName: null }, created.id);
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
		const checkedOut = present(version, version.id);
		if (!uncommitted && target.headVersionId === version.id) {
			return { checkedOut, canvasRevision: target.canvasRevision, warnings: [], changed: false };
		}

		// refused before anything is written, so a clash saves nothing either
		if (kind === "route") await assertNoPathClash(target, version.snapshot.settings, tx);

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
		return {
			savedVersion: saved ? present({ ...saved, authorName: null }, null) : undefined,
			checkedOut,
			canvasRevision,
			warnings: skipped.length
				? [
						`${skipped.length} middleware(s) from that version no longer exist and were not attached.`,
					]
				: [],
			changed: true,
		};
	});

	const { changed, ...result } = outcome;
	// the usual change signal, so development recompiles the restored canvas
	if (changed) await publishMessage(CHANGE_CHANNEL[kind], id);
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
		versions: rows.map((row) => present(row, target.headVersionId)),
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
	return { ...present(version, target.headVersionId), snapshot: version.snapshot };
}

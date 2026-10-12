import { desc, eq, max } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { systemUsers } from "../../db/auth-schema";
import {
	type CanvasSnapshot,
	type CanvasVersionKind,
	canvasVersionsEntity,
	customBlocksListEntity,
	middlewaresEntity,
	routesEntity,
	type VersionSnapshot,
	workflowsEntity,
} from "../../db/schema";

/**
 * Every query in versioning goes through here, and none of them updates a
 * version row: a version is written once.
 */

const tables = {
	route: routesEntity,
	workflow: workflowsEntity,
	custom_block: customBlocksListEntity,
	middleware: middlewaresEntity,
} as const;

export function targetTable(kind: CanvasVersionKind) {
	return tables[kind];
}

const ownerColumns = {
	route: canvasVersionsEntity.routeId,
	workflow: canvasVersionsEntity.workflowId,
	custom_block: canvasVersionsEntity.customBlockId,
	middleware: canvasVersionsEntity.middlewareId,
} as const;

/** The column of `canvas_versions` that points at this kind of target. */
function ownerColumn(kind: CanvasVersionKind) {
	return ownerColumns[kind];
}

/** The id of the route, workflow, custom block or middleware a version row belongs to. */
export const ownerOf = (row: {
	routeId: string | null;
	workflowId: string | null;
	customBlockId: string | null;
	middlewareId: string | null;
}) => (row.routeId ?? row.workflowId ?? row.customBlockId ?? row.middlewareId)!;

/**
 * The route, workflow, custom block or middleware row. With `lock`, `FOR UPDATE`:
 * commit and checkout hold it for their whole transaction, so two of them never
 * run side by side.
 */
export async function readTarget(
	kind: CanvasVersionKind,
	id: string,
	tx: DbTransactionType | undefined,
	lock = false,
) {
	const table = targetTable(kind);
	const query = (tx ?? db)
		.select({
			id: table.id,
			name: table.name,
			projectId: table.projectId,
			canvasRevision: table.canvasRevision,
			committedRevision: table.committedRevision,
			headVersionId: table.headVersionId,
			prodVersionId: table.prodVersionId,
		})
		.from(table)
		.where(eq(table.id, id));
	const [row] = await (lock ? query.for("update") : query);
	return row;
}

/** The user a version or deployment is credited to: their id and email, or nothing for an unknown user. */
export async function findAuthor(userId: string | undefined, tx: DbTransactionType) {
	if (!userId) return undefined;
	const [author] = await tx
		.select({ id: systemUsers.id, email: systemUsers.email })
		.from(systemUsers)
		.where(eq(systemUsers.id, userId));
	return author;
}

/** The number a new version of this target takes: the highest so far, plus one. */
export async function nextVersionNumber(
	kind: CanvasVersionKind,
	id: string,
	tx: DbTransactionType,
) {
	const [row] = await tx
		.select({ highest: max(canvasVersionsEntity.versionNumber) })
		.from(canvasVersionsEntity)
		.where(eq(ownerColumn(kind), id));
	return (row?.highest ?? 0) + 1;
}

export async function insertVersion(
	values: {
		kind: CanvasVersionKind;
		targetId: string;
		projectId: string;
		versionNumber: number;
		parentId: string | null;
		title: string;
		description: string | null;
		authorId: string | null;
		authorEmail: string | null;
		snapshot: VersionSnapshot;
	},
	tx: DbTransactionType,
) {
	const { targetId, ...row } = values;
	const [created] = await tx
		.insert(canvasVersionsEntity)
		.values({
			...row,
			routeId: row.kind === "route" ? targetId : null,
			workflowId: row.kind === "workflow" ? targetId : null,
			customBlockId: row.kind === "custom_block" ? targetId : null,
			middlewareId: row.kind === "middleware" ? targetId : null,
		})
		.returning();
	return created!;
}

const withAuthorName = {
	id: canvasVersionsEntity.id,
	kind: canvasVersionsEntity.kind,
	routeId: canvasVersionsEntity.routeId,
	workflowId: canvasVersionsEntity.workflowId,
	customBlockId: canvasVersionsEntity.customBlockId,
	middlewareId: canvasVersionsEntity.middlewareId,
	projectId: canvasVersionsEntity.projectId,
	versionNumber: canvasVersionsEntity.versionNumber,
	parentId: canvasVersionsEntity.parentId,
	title: canvasVersionsEntity.title,
	description: canvasVersionsEntity.description,
	authorEmail: canvasVersionsEntity.authorEmail,
	authorName: systemUsers.name,
	createdAt: canvasVersionsEntity.createdAt,
};

/** Newest first; the snapshots stay out, a list never needs them. */
export async function listVersions(kind: CanvasVersionKind, id: string, tx?: DbTransactionType) {
	return await (tx ?? db)
		.select(withAuthorName)
		.from(canvasVersionsEntity)
		.leftJoin(systemUsers, eq(systemUsers.id, canvasVersionsEntity.authorId))
		.where(eq(ownerColumn(kind), id))
		.orderBy(desc(canvasVersionsEntity.versionNumber));
}

/** One version of this target, with its snapshot — never another target's. */
export async function findVersion(
	kind: CanvasVersionKind,
	id: string,
	versionId: string,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.select({ ...withAuthorName, snapshot: canvasVersionsEntity.snapshot })
		.from(canvasVersionsEntity)
		.leftJoin(systemUsers, eq(systemUsers.id, canvasVersionsEntity.authorId))
		.where(eq(canvasVersionsEntity.id, versionId))
		.limit(1);
	if (!row) return undefined;
	return row.kind === kind && ownerOf(row) === id ? row : undefined;
}

/** `vN` of a version, for the one a target was last committed or checked out at. */
export async function versionNumberOf(versionId: string | null, tx?: DbTransactionType) {
	if (!versionId) return null;
	const [row] = await (tx ?? db)
		.select({ versionNumber: canvasVersionsEntity.versionNumber })
		.from(canvasVersionsEntity)
		.where(eq(canvasVersionsEntity.id, versionId));
	return row?.versionNumber ?? null;
}

/**
 * What production serves: the snapshot of one version, by id alone. The compiler
 * reads it, and it already holds the id from the row it is compiling. The type
 * is the caller's to name: a route's or workflow's by default, `CustomBlockSnapshot`
 * or `MiddlewareSnapshot` where it holds the id of one of those.
 */
export async function readSnapshot<T extends VersionSnapshot = CanvasSnapshot>(
	versionId: string,
	tx?: DbTransactionType,
) {
	const [row] = await (tx ?? db)
		.select({ snapshot: canvasVersionsEntity.snapshot })
		.from(canvasVersionsEntity)
		.where(eq(canvasVersionsEntity.id, versionId));
	return row?.snapshot as T | undefined;
}

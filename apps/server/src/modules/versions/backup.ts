import { generateID } from "@fluxify/lib";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbTransactionType } from "../../db";
import {
	type CanvasVersionKind,
	canvasVersionsEntity,
	type VersionSnapshot,
} from "../../db/schema";
import { insertVersion, ownerColumn, targetTable } from "./repository";

/**
 * A target's versions in a project backup (#1099): the promoted version always,
 * the head and the rest only with version history. Versions travel by number,
 * never by id, and every reference to another resource inside a snapshot
 * travels by name: the caller converts in both directions.
 */

const snapshotSchema = z.object({
	blocks: z.array(
		z.object({
			id: z.string(),
			key: z.string(),
			type: z.string(),
			data: z.unknown(),
			position: z.object({ x: z.number(), y: z.number() }),
		}),
	),
	edges: z.array(
		z.object({
			id: z.string(),
			from: z.string(),
			to: z.string(),
			fromHandle: z.string().nullable(),
			toHandle: z.string().nullable(),
		}),
	),
	settings: z.record(z.string(), z.unknown()),
});

export const backupVersionSchema = z.object({
	number: z.number().int().min(1),
	/** the version this one was committed on top of, when it is in the backup */
	parent: z.number().int().nullable().default(null),
	title: z.string(),
	description: z.string().nullable().default(null),
	authorEmail: z.string().nullable().default(null),
	createdAt: z.string(),
	snapshot: snapshotSchema,
});

export const backupHistorySchema = z.object({
	/** the working copy, in the same portable form as a version's snapshot */
	working: snapshotSchema,
	versions: z.array(backupVersionSchema).default([]),
	/** what production serves; null when nothing was promoted */
	prod: z.number().int().nullable().default(null),
	/** what the working copy came from, when that version is in the backup */
	head: z.number().int().nullable().default(null),
	canvasRevision: z.number().int().default(0),
	committedRevision: z.number().int().nullable().default(null),
});

export type BackupHistory = z.infer<typeof backupHistorySchema>;
export type PortableSnapshot = z.infer<typeof snapshotSchema>;

type Convert = (snapshot: VersionSnapshot) => VersionSnapshot | Promise<VersionSnapshot>;

/**
 * Reads a target's working copy and versions. `working` is the snapshot the
 * caller built of the working copy (`buildSnapshot`); `portable` turns ids of
 * other resources in a snapshot into names.
 */
export async function exportHistory(
	kind: CanvasVersionKind,
	id: string,
	working: VersionSnapshot,
	includeVersionHistory: boolean,
	portable: Convert,
	tx: DbTransactionType,
): Promise<BackupHistory> {
	const table = targetTable(kind);
	const [row] = await tx
		.select({
			canvasRevision: table.canvasRevision,
			committedRevision: table.committedRevision,
			headVersionId: table.headVersionId,
			prodVersionId: table.prodVersionId,
		})
		.from(table)
		.where(eq(table.id, id));
	const all = await tx
		.select()
		.from(canvasVersionsEntity)
		.where(eq(ownerColumn(kind), id))
		.orderBy(asc(canvasVersionsEntity.versionNumber));
	const kept = includeVersionHistory ? all : all.filter((v) => v.id === row!.prodVersionId);
	const numberOf = (versionId: string | null) =>
		kept.find((v) => v.id === versionId)?.versionNumber ?? null;
	const head = numberOf(row!.headVersionId);

	return {
		working: (await portable(working)) as PortableSnapshot,
		versions: await Promise.all(
			kept.map(async (v) => ({
				number: v.versionNumber,
				parent: numberOf(v.parentId),
				title: v.title,
				description: v.description,
				authorEmail: v.authorEmail,
				createdAt: v.createdAt.toISOString(),
				snapshot: (await portable(v.snapshot)) as PortableSnapshot,
			})),
		),
		prod: numberOf(row!.prodVersionId),
		head,
		canvasRevision: row!.canvasRevision,
		// without its head the copy cannot claim to match a commit
		committedRevision: head === null ? null : row!.committedRevision,
	};
}

/**
 * Writes the versions of a freshly created target and points its head and
 * production at them, as a promote would, without running the gates: they
 * passed before the backup was taken. The working copy is the caller's to write
 * (`restoreSnapshot`). `local` turns names back into this project's ids.
 */
export async function importHistory(
	kind: CanvasVersionKind,
	target: { id: string; projectId: string },
	history: BackupHistory,
	local: Convert,
	tx: DbTransactionType,
) {
	const ids = new Map<number, string>();
	// numbers ascend, so a parent is always written before its child
	for (const v of [...history.versions].sort((a, b) => a.number - b.number)) {
		const created = await insertVersion(
			{
				kind,
				targetId: target.id,
				projectId: target.projectId,
				versionNumber: v.number,
				parentId: v.parent === null ? null : (ids.get(v.parent) ?? null),
				title: v.title,
				description: v.description,
				authorId: null,
				authorEmail: v.authorEmail,
				snapshot: await local(v.snapshot as VersionSnapshot),
				createdAt: new Date(v.createdAt),
			},
			tx,
		);
		ids.set(v.number, created.id);
	}
	const pointer = (n: number | null) => (n === null ? null : (ids.get(n) ?? null));
	const headVersionId = pointer(history.head);
	const table = targetTable(kind);
	await tx
		.update(table)
		.set({
			canvasRevision: history.canvasRevision,
			committedRevision: headVersionId ? history.committedRevision : null,
			headVersionId,
			prodVersionId: pointer(history.prod),
		})
		.where(eq(table.id, target.id));
}

/**
 * Block and edge ids are unique across every canvas of the instance, so a
 * restore next to its source would collide. One fresh id per old id, applied to
 * the working copy and every version alike, keeps them consistent with each
 * other (a checkout upserts by id). Ids are UUIDs, so replacing them where they
 * appear as a whole string or as a handle prefix (`<id>-source`) is exact.
 *
 * `value` defaults to the history itself; pass a record that holds it (with
 * `history`) to rewrite references outside it too, such as a test suite's block
 * hooks.
 */
export function freshCanvasIds<T = BackupHistory>(
	value: T,
	history: BackupHistory = value as BackupHistory,
): T {
	const snapshots = [history.working, ...history.versions.map((v) => v.snapshot)];
	const old = new Set(snapshots.flatMap((s) => [...s.blocks, ...s.edges].map((x) => x.id)));
	if (old.size === 0) return value;
	const fresh = new Map([...old].map((id) => [id, generateID()]));
	const pattern = new RegExp(`"(${[...old].map(literal).join("|")})(["-])`, "g");
	const json = JSON.stringify(value).replace(
		pattern,
		(_, id: string, end: string) => `"${fresh.get(id)}${end}`,
	);
	return JSON.parse(json);
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

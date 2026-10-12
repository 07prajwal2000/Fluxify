import { eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { type AuthACL, customBlocksListEntity, middlewaresEntity } from "../../db/schema";
import { ConflictError } from "../../errors/conflictError";
import { ForbiddenError } from "../../errors/forbidError";
import { NotFoundError } from "../../errors/notFoundError";
import { canAccessProject } from "../../lib/acl";
import { NOT_FOUND } from "../versions/targets";
import { describeReference, findReferences, type Reference } from "./finder";

/**
 * The reference finder behind its two doors (#740): `GET .../references` for the
 * "Used by" list, and the delete guard. One finder, so the list and the refusal
 * can never disagree about who uses a block.
 */

export type ReferenceSubjectKind = "custom_block" | "middleware";

async function readSubject(
	kind: ReferenceSubjectKind,
	id: string,
	tx: DbTransactionType | typeof db,
) {
	const table = kind === "custom_block" ? customBlocksListEntity : middlewaresEntity;
	const [row] = await tx
		.select({ id: table.id, name: table.name, projectId: table.projectId })
		.from(table)
		.where(eq(table.id, id));
	return row;
}

export async function listReferences(kind: ReferenceSubjectKind, id: string, acl: AuthACL[]) {
	const subject = await readSubject(kind, id, db);
	if (!subject) throw new NotFoundError(NOT_FOUND[kind]);
	if (!subject.projectId || !canAccessProject(acl, subject.projectId, "viewer")) {
		throw new ForbiddenError();
	}
	return {
		references: await findReferences({
			kind,
			id,
			name: subject.name,
			projectId: subject.projectId,
		}),
	};
}

/** The 409 of a refused delete: says who uses it, and carries the same list as the endpoint. */
export class InUseError extends ConflictError {
	constructor(noun: string, references: Reference[]) {
		super(
			`This ${noun} is still used by ${references.map(describeReference).join(", ")}. Remove it there first.`,
		);
		this.details = { references };
	}
}

/**
 * Refuses a delete while anything uses the subject: a working copy, a promoted
 * version or a test hook. Versions that are not live do not count, so nothing
 * here looks at version history. Sandboxes are not users.
 */
export async function assertNotInUse(
	kind: ReferenceSubjectKind,
	subject: { id: string; name: string; projectId: string },
	tx: DbTransactionType,
) {
	const references = await findReferences({ kind, ...subject }, tx);
	if (references.length)
		throw new InUseError(kind === "custom_block" ? "custom block" : "middleware", references);
}

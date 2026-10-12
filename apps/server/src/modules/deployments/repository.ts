import { and, desc, eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { systemUsers } from "../../db/auth-schema";
import {
	type CanvasVersionKind,
	canvasVersionsEntity,
	type DeploymentAction,
	type DeploymentStatus,
	deploymentsEntity,
	type GateResult,
} from "../../db/schema";
import { targetTable } from "../versions/repository";

/** Every query in the deployment log goes through here. */

const ownerColumns = {
	route: deploymentsEntity.routeId,
	workflow: deploymentsEntity.workflowId,
	custom_block: deploymentsEntity.customBlockId,
	middleware: deploymentsEntity.middlewareId,
} as const;

function ownerColumn(kind: CanvasVersionKind) {
	return ownerColumns[kind];
}

export async function insertDeployment(
	values: {
		kind: CanvasVersionKind;
		targetId: string;
		projectId: string;
		versionId: string;
		action: DeploymentAction;
		description: string;
		authorId: string | null;
		authorEmail: string | null;
	},
	tx: DbTransactionType,
) {
	const { targetId, ...row } = values;
	const [created] = await tx
		.insert(deploymentsEntity)
		.values({
			...row,
			status: "pending",
			routeId: row.kind === "route" ? targetId : null,
			workflowId: row.kind === "workflow" ? targetId : null,
			customBlockId: row.kind === "custom_block" ? targetId : null,
			middlewareId: row.kind === "middleware" ? targetId : null,
		})
		.returning();
	return created!;
}

/** The deployments of this target that have not finished. */
export async function pendingDeployments(
	kind: CanvasVersionKind,
	id: string,
	tx: DbTransactionType,
) {
	return await tx
		.select({ id: deploymentsEntity.id, createdAt: deploymentsEntity.createdAt })
		.from(deploymentsEntity)
		.where(and(eq(ownerColumn(kind), id), eq(deploymentsEntity.status, "pending")));
}

export async function finishDeployment(
	id: string,
	status: Exclude<DeploymentStatus, "pending">,
	gates: GateResult[],
	tx: DbTransactionType | typeof db = db,
) {
	await tx
		.update(deploymentsEntity)
		.set({ status, gates, finishedAt: new Date() })
		.where(eq(deploymentsEntity.id, id));
}

/** Points production at a version; only a finished promote or rollback calls this. */
export async function setProdVersion(
	kind: CanvasVersionKind,
	id: string,
	versionId: string,
	tx: DbTransactionType,
) {
	const table = targetTable(kind);
	await tx
		.update(table)
		// a deployment is not an edit: "last edited" stays as it was
		.set({ prodVersionId: versionId, updatedAt: table.updatedAt })
		.where(eq(table.id, id));
}

const withNames = {
	id: deploymentsEntity.id,
	kind: deploymentsEntity.kind,
	routeId: deploymentsEntity.routeId,
	workflowId: deploymentsEntity.workflowId,
	customBlockId: deploymentsEntity.customBlockId,
	middlewareId: deploymentsEntity.middlewareId,
	versionId: deploymentsEntity.versionId,
	versionNumber: canvasVersionsEntity.versionNumber,
	action: deploymentsEntity.action,
	description: deploymentsEntity.description,
	authorEmail: deploymentsEntity.authorEmail,
	authorName: systemUsers.name,
	status: deploymentsEntity.status,
	gates: deploymentsEntity.gates,
	createdAt: deploymentsEntity.createdAt,
	finishedAt: deploymentsEntity.finishedAt,
};

function selectDeployments(tx?: DbTransactionType) {
	return (tx ?? db)
		.select(withNames)
		.from(deploymentsEntity)
		.innerJoin(canvasVersionsEntity, eq(canvasVersionsEntity.id, deploymentsEntity.versionId))
		.leftJoin(systemUsers, eq(systemUsers.id, deploymentsEntity.authorId));
}

/** Newest first. */
export async function listDeployments(kind: CanvasVersionKind, id: string) {
	return await selectDeployments()
		.where(eq(ownerColumn(kind), id))
		.orderBy(desc(deploymentsEntity.createdAt), desc(deploymentsEntity.id));
}

/** One deployment of this target — never another target's. */
export async function findDeployment(
	kind: CanvasVersionKind,
	id: string,
	deploymentId: string,
	tx?: DbTransactionType,
) {
	const [row] = await selectDeployments(tx).where(
		and(eq(deploymentsEntity.id, deploymentId), eq(ownerColumn(kind), id)),
	);
	return row;
}

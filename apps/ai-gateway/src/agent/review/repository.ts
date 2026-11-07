import { generateID } from "@fluxify/lib";
import {
	db,
	type ReviewFinding,
	agentReviewsEntity as reviews,
	routesEntity,
	workflowsEntity,
} from "@fluxify/server";
import { and, eq } from "drizzle-orm";

/** AI canvas reviews (#754): one row per route or workflow, the latest review. */
export type ReviewKind = "route" | "workflow";
export type Review = typeof reviews.$inferSelect;

const TARGETS = { route: routesEntity, workflow: workflowsEntity };

/** The target's canvas revision now; undefined when it is not in this project. */
export async function targetRevision(
	kind: ReviewKind,
	id: string,
	projectId: string,
): Promise<number | undefined> {
	const t = TARGETS[kind];
	const [row] = await db
		.select({ revision: t.canvasRevision })
		.from(t)
		.where(and(eq(t.id, id), eq(t.projectId, projectId)));
	return row?.revision;
}

export async function getReview(kind: ReviewKind, targetId: string, projectId: string) {
	const [row] = await db
		.select()
		.from(reviews)
		.where(
			and(eq(reviews.kind, kind), eq(reviews.targetId, targetId), eq(reviews.projectId, projectId)),
		);
	return row as Review | undefined;
}

/** A new running review in place of the last one, under a new id. */
export async function startReview(
	kind: ReviewKind,
	targetId: string,
	projectId: string,
	userId: string,
) {
	const fresh = {
		id: generateID(),
		userId,
		status: "running" as const,
		canvasRevision: null,
		summary: null,
		findings: null,
		error: null,
		usage: null,
		createdAt: new Date(),
		completedAt: null,
		updatedAt: new Date(),
	};
	const [row] = await db
		.insert(reviews)
		.values({ ...fresh, kind, targetId, projectId })
		.onConflictDoUpdate({ target: [reviews.kind, reviews.targetId], set: fresh })
		.returning();
	return row as Review;
}

/** Only a review still running under this id changes; false when it was stopped or replaced. */
async function whileRunning(id: string, set: Partial<Review>) {
	const rows = await db
		.update(reviews)
		.set(set)
		.where(and(eq(reviews.id, id), eq(reviews.status, "running")))
		.returning({ id: reviews.id });
	return rows.length > 0;
}

/** The heartbeat; false once the review was stopped or replaced. */
export const touchReview = (id: string) => whileRunning(id, { updatedAt: new Date() });

export const finishReview = (
	id: string,
	r: {
		canvasRevision: number;
		summary: string;
		findings: ReviewFinding[];
		usage: { inputTokens: number; outputTokens: number };
	},
) => whileRunning(id, { ...r, status: "completed", completedAt: new Date() });

export const endReview = (id: string, status: "failed" | "cancelled", error?: string) =>
	whileRunning(id, { status, error: error ?? null, completedAt: new Date() });

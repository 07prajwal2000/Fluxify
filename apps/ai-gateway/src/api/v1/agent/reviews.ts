import { type AccessControlRole, BadRequestError, NotFoundError } from "@fluxify/server";
import type { Context, Hono } from "hono";
import {
	endReview,
	getReview,
	type Review,
	type ReviewKind,
	startReview,
	targetRevision,
} from "../../../agent/review/repository";
import { hasAgentConnection } from "../../../agent/runner/integration";
import { isHeld, publishAgentJob, requestStop } from "../../../agent/runner/queue";
import { AGENT_RUN_STALE_MS } from "../../../lib/env";
import { assertRunQuota } from "./rateLimit";

type Caller = (c: Context, projectId: string, role: AccessControlRole) => { id: string };

const KINDS = new Set<string>(["route", "workflow"]);

/** The caller, once they hold `role`, and the route or workflow in the URL, once it is this project's. */
async function targetOf(c: Context, caller: Caller, role: AccessControlRole) {
	const projectId = c.req.param("projectId") as string;
	const user = caller(c, projectId, role);
	const kind = c.req.param("kind") as ReviewKind;
	const targetId = c.req.param("targetId") as string;
	const revision = KINDS.has(kind) ? await targetRevision(kind, targetId, projectId) : undefined;
	if (revision === undefined) throw new NotFoundError(`No such ${kind} in this project`);
	return { user, projectId, kind, targetId, revision };
}

/** A running review nobody holds once the stale window passed: its worker died. */
async function released(review: Review | undefined) {
	if (review?.status !== "running") return review;
	if (Date.now() - review.updatedAt.getTime() < AGENT_RUN_STALE_MS || (await isHeld(review.id)))
		return review;
	await endReview(
		review.id,
		"failed",
		"The review stopped because the server restarted. Run it again.",
	);
	return { ...review, status: "failed" as const };
}

/** The report, and whether the canvas changed since the review read it. */
const report = (review: Review | undefined, revision: number) =>
	review
		? {
				...review,
				stale: review.canvasRevision !== null && review.canvasRevision !== revision,
			}
		: null;

/**
 * AI canvas review (#754) of a route or workflow, the latest one each. Anyone in
 * the project reads the report; creators start and stop one. Runs on the agent
 * worker as a `review` job.
 */
export function registerReviewRoutes(r: Hono, caller: Caller) {
	const base = "/:projectId/reviews/:kind/:targetId";

	r.get(base, async (c) => {
		const t = await targetOf(c, caller, "viewer");
		return c.json(
			report(await released(await getReview(t.kind, t.targetId, t.projectId)), t.revision),
		);
	});

	// A review already running is returned as it is: a second click starts nothing.
	r.post(base, async (c) => {
		const t = await targetOf(c, caller, "creator");
		const current = await released(await getReview(t.kind, t.targetId, t.projectId));
		if (current?.status === "running") return c.json(report(current, t.revision), 200);
		if (!(await hasAgentConnection(t.projectId)))
			throw new BadRequestError("Pick an AI connection in the project's AI settings first.");
		await assertRunQuota(t.user.id);
		const review = await startReview(t.kind, t.targetId, t.projectId, t.user.id);
		await publishAgentJob({
			type: "review",
			conversationId: review.id,
			runId: review.id,
			userId: t.user.id,
			projectId: t.projectId,
			mode: "manual",
			review: { kind: t.kind, targetId: t.targetId },
		});
		return c.json(report(review, t.revision), 202);
	});

	// The worker holding it stops it; one nobody holds yet is cancelled here.
	r.post(`${base}/stop`, async (c) => {
		const t = await targetOf(c, caller, "creator");
		const review = await getReview(t.kind, t.targetId, t.projectId);
		if (review?.status === "running") {
			if (await isHeld(review.id)) await requestStop(review.id);
			else await endReview(review.id, "cancelled");
		}
		return c.json(report(await getReview(t.kind, t.targetId, t.projectId), t.revision), 202);
	});
}

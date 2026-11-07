import type { ReviewFinding } from "@fluxify/server";
import { httpClient } from "@/lib/http";

export type { ReviewFinding };
export type ReviewKind = "route" | "workflow";

/** The latest AI canvas review of a route or workflow (#754). */
export type AgentReview = {
	id: string;
	kind: ReviewKind;
	targetId: string;
	status: "running" | "completed" | "failed" | "cancelled";
	summary: string | null;
	findings: ReviewFinding[] | null;
	error: string | null;
	canvasRevision: number | null;
	createdAt: string;
	completedAt: string | null;
	/** the canvas was saved since the review read it */
	stale: boolean;
};

const path = (projectId: string, kind: ReviewKind, id: string) =>
	`ai/v1/agent/${projectId}/reviews/${kind}/${id}`;

export const agentReviewsService = {
	/** null before the first review */
	async get(projectId: string, kind: ReviewKind, id: string): Promise<AgentReview | null> {
		return (await httpClient.get(path(projectId, kind, id))).data;
	},
	/** starts one, or returns the one already running */
	async start(projectId: string, kind: ReviewKind, id: string): Promise<AgentReview> {
		return (await httpClient.post(path(projectId, kind, id))).data;
	},
	async stop(projectId: string, kind: ReviewKind, id: string): Promise<AgentReview | null> {
		return (await httpClient.post(`${path(projectId, kind, id)}/stop`)).data;
	},
};

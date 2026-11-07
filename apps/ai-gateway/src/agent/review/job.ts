import { getProjectSetting } from "@fluxify/server";
import { mintAgentToken } from "@fluxify/server/src/lib/agentToken";
import type { LanguageModel } from "ai";
import { type AdminFetch, adminApi, httpAdminFetch } from "../../mcp/adminApi";
import { modelFromIntegration } from "../model";
import { agentIntegration } from "../runner/integration";
import type { AgentJob } from "../runner/queue";
import { limitsFromProject } from "../timeouts";
import { reviewContext } from "./context";
import { endReview, finishReview, touchReview } from "./repository";
import { reviewPrompt, runReview, toFindings, tooBig } from "./review";

const LIMIT_KEYS = ["settings.ai.tokenBudget", "settings.ai.maxContextTokens"] as const;

export type ReviewDeps = {
	fetcher: AdminFetch;
	/** The project's agent model; undefined with no AI connection. */
	model: (projectId: string) => Promise<LanguageModel | undefined>;
	setting: (projectId: string, key: (typeof LIMIT_KEYS)[number]) => Promise<string | undefined>;
	token: (userId: string, projectId: string) => string;
	run: typeof runReview;
	touch: typeof touchReview;
	finish: typeof finishReview;
	end: typeof endReview;
};

const defaults: ReviewDeps = {
	fetcher: httpAdminFetch,
	model: async (projectId) => {
		const integration = await agentIntegration(projectId);
		return integration && modelFromIntegration(integration);
	},
	setting: getProjectSetting,
	token: (userId, projectId) => mintAgentToken(userId, projectId),
	run: runReview,
	touch: touchReview,
	finish: finishReview,
	end: endReview,
};

/**
 * One AI canvas review (#754). The job's `conversationId` and `runId` are the
 * review's id. Reads the target and what it uses as the user who asked, with
 * read-only tools, then makes one model call with no tools at all: the canvas
 * is untrusted text, so there is nothing for an injected instruction to call.
 */
export async function executeReview(job: AgentJob, signal: AbortSignal, d = defaults) {
	const id = job.runId;
	// stopped or replaced before a worker took it
	if (!job.review || !(await d.touch(id))) return "skipped" as const;
	try {
		const model = await d.model(job.projectId);
		if (!model)
			throw new Error("This project has no AI connection. Pick one in the project's AI settings.");
		const settings: Record<string, string | undefined> = {};
		for (const key of LIMIT_KEYS) settings[key] = await d.setting(job.projectId, key);
		const limits = limitsFromProject(settings, process.env);
		const api = adminApi(
			d.fetcher,
			{ authorization: `Bearer ${d.token(job.userId, job.projectId)}` },
			"viewer",
			signal,
		);
		const { kind, targetId } = job.review;
		const { revision, blocks, context } = await reviewContext(api, job.projectId, kind, targetId);
		const prompt = reviewPrompt(context);
		const big = tooBig(prompt, limits);
		if (big) throw new Error(big);
		const r = await d.run(model, kind, prompt, limits, signal);
		await d.finish(id, {
			...r,
			canvasRevision: revision,
			findings: toFindings(r.findings, blocks),
		});
		return "completed" as const;
	} catch (e) {
		if (signal.aborted) {
			await d.end(id, "cancelled");
			return "cancelled" as const;
		}
		await d.end(id, "failed", e instanceof Error ? e.message : String(e));
		return "failed" as const;
	}
}

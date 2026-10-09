import {
	agentHarnessConversationsEntity as conversations,
	db,
	agentHarnessRunsEntity as runs,
} from "@fluxify/server";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { StopReason } from "../agent";
import type { Effort } from "../model";
import type { RunStatus } from "../store";
import type { Mode } from "../tools";

/**
 * Conversations and runs of the new agent, in the harness tables (#646).
 * `metadata.agent` marks a conversation as the new agent's; `metadata.mode`
 * is the accept mode and `metadata.effort` the thinking level of the last message
 * or approval (the picker starts from them, an approval goes on in them).
 */
export type AgentMeta = { agent: true; mode: Mode; effort?: Effort };
/** What a run cost: summed over the jobs of a run (a run with approvals is several). */
export type RunUsage = {
	steps: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	durationMs: number;
};
export type Conversation = typeof conversations.$inferSelect;

/** Statuses after which no job holds the run. */
export const SETTLED: RunStatus[] = ["completed", "failed", "interrupted", "waiting_approval"];
const LIVE = ["running", "paused_hitl"] as const;

export async function createConversation(userId: string, projectId: string, title?: string) {
	const [row] = await db
		.insert(conversations)
		.values({ userId, projectId, title, metadata: { agent: true, mode: "manual" } })
		.returning();
	return row;
}

export const listConversations = (userId: string, projectId: string) =>
	db
		.select()
		.from(conversations)
		.where(
			and(
				eq(conversations.userId, userId),
				eq(conversations.projectId, projectId),
				sql`${conversations.metadata}->>'agent' = 'true'`,
			),
		)
		.orderBy(desc(conversations.updatedAt))
		.limit(100);

export async function getConversation(id: string) {
	const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
	return row as Conversation | undefined;
}

export async function getRun(id: string) {
	const [row] = await db.select().from(runs).where(eq(runs.id, id));
	return row;
}

/**
 * Creates a run and claims the conversation for it with a conditional update,
 * so two sends at once cannot both win; the loser's run row is removed. Null
 * when a run already holds the conversation.
 */
export async function startRun(
	conversationId: string,
	message: string,
	mode: Mode,
	effort?: Effort,
) {
	const [run] = await db
		.insert(runs)
		.values({ conversationId, userQuery: message, status: "queued" })
		.returning({ id: runs.id });
	const claimed = await db
		.update(conversations)
		.set({
			activeRunId: run.id,
			status: "running",
			metadata: { agent: true, mode, ...(effort && { effort }) } satisfies AgentMeta,
		})
		.where(and(eq(conversations.id, conversationId), notInArray(conversations.status, [...LIVE])))
		.returning({ id: conversations.id });
	if (claimed.length) return run.id;
	await db.delete(runs).where(eq(runs.id, run.id));
	return null;
}

/**
 * Claims a conversation waiting on `runId` for the approval answer and queues
 * the run again, so a stream opened now does not read it as settled.
 */
export async function claimContinue(conversationId: string, runId: string) {
	const rows = await db
		.update(conversations)
		.set({ status: "running" })
		.where(
			and(
				eq(conversations.id, conversationId),
				eq(conversations.status, "paused_hitl"),
				eq(conversations.activeRunId, runId),
			),
		)
		.returning({ id: conversations.id });
	if (!rows.length) return false;
	await db
		.update(runs)
		.set({ status: "queued" })
		.where(and(eq(runs.id, runId), eq(runs.status, "waiting_approval")));
	return true;
}

/** Worker gate: moves a queued run to executing; false means another job has it, or it was stopped. */
export async function claimRun(runId: string) {
	const rows = await db
		.update(runs)
		.set({ status: "executing" })
		.where(and(eq(runs.id, runId), eq(runs.status, "queued")))
		.returning({ id: runs.id });
	return rows.length > 0;
}

const CONVERSATION_STATUS = {
	completed: "completed",
	failed: "failed",
	interrupted: "interrupted",
	waiting_approval: "paused_hitl",
} as const;

/** The conversation follows its run once the run settles; `stopReason` says it stopped at a limit. */
export async function settleConversation(
	conversationId: string,
	runId: string,
	status: RunStatus,
	stopReason?: StopReason,
) {
	const next = CONVERSATION_STATUS[status as keyof typeof CONVERSATION_STATUS] ?? "failed";
	await db.update(conversations).set({ status: next }).where(eq(conversations.id, conversationId));
	if (status !== "waiting_approval")
		await db
			.update(runs)
			.set({ completedAt: new Date(), stopReason: stopReason ?? null })
			.where(eq(runs.id, runId));
}

/** Stops a run no job holds (queued, or waiting on an approval). False when a job is running it. */
export async function interruptIdle(conversationId: string, runId: string) {
	const rows = await db
		.update(runs)
		.set({ status: "interrupted", interruptedAt: new Date() })
		.where(and(eq(runs.id, runId), inArray(runs.status, ["queued", "waiting_approval"])))
		.returning({ id: runs.id });
	if (!rows.length) return false;
	await db
		.update(conversations)
		.set({ status: "interrupted" })
		.where(eq(conversations.id, conversationId));
	return true;
}

/** Saves the mode and effort an approval picked on the conversation. */
export const setMeta = (conversationId: string, meta: AgentMeta) =>
	db.update(conversations).set({ metadata: meta }).where(eq(conversations.id, conversationId));

/** Adds one job's cost to the run's usage. Jobs of a run never overlap, so read-then-write is safe. */
export async function addRunUsage(runId: string, add: RunUsage) {
	const run = await getRun(runId);
	const was = (run?.usage ?? {}) as Partial<RunUsage>;
	const usage: RunUsage = {
		steps: (was.steps ?? 0) + add.steps,
		inputTokens: (was.inputTokens ?? 0) + add.inputTokens,
		outputTokens: (was.outputTokens ?? 0) + add.outputTokens,
		cacheReadTokens: (was.cacheReadTokens ?? 0) + add.cacheReadTokens,
		durationMs: (was.durationMs ?? 0) + add.durationMs,
	};
	await db.update(runs).set({ usage }).where(eq(runs.id, runId));
}

/** Rename, pin and archive. The caller has checked the combination. */
export async function updateConversation(
	conversationId: string,
	patch: { title?: string; pinned?: boolean; archived?: boolean },
) {
	const [row] = await db
		.update(conversations)
		.set(patch)
		.where(eq(conversations.id, conversationId))
		.returning();
	return row;
}

export const deleteConversation = (conversationId: string) =>
	db.delete(conversations).where(eq(conversations.id, conversationId));

import { logger } from "@fluxify/common";
import { db } from "@fluxify/server";
import { AGENT_RUN_STALE_MS } from "../../lib/env";
import { type AgentStore, agentStore } from "../store";
import { type RunDeps, rejectPending } from "./job";
import { isHeld, publishRunEvents } from "./queue";
import {
	type Conversation,
	executingRuns,
	getConversation,
	getRun,
	interruptOrphan,
	settleConversation,
} from "./repository";

/**
 * Runs whose worker died (#696). A job touches its run every HEARTBEAT_MS while it
 * executes; an executing run with no touch for the stale window, or that no live
 * worker answers for, is released: interrupted, its conversation free, and the
 * user told to send a message to continue. waiting_approval runs are never touched
 * here: they wait for the user, not for a job.
 */
export const HEARTBEAT_MS = 20_000;

type RunRow = { id: string; conversationId: string; status: string; updatedAt: Date };

export type OrphanDeps = {
	store: AgentStore;
	staleMs: number;
	/** Does a live worker hold this run? */
	held: (runId: string) => Promise<boolean>;
	/** executing → interrupted; false when someone else got there first. */
	claim: (runId: string) => Promise<boolean>;
	settle: RunDeps["settle"];
	publish: RunDeps["publish"];
	executing: () => Promise<RunRow[]>;
};

/** Read per call: `db` is only set once drizzleInit ran, after this module loaded. */
export const orphanDeps: OrphanDeps = {
	get store() {
		return agentStore(db);
	},
	staleMs: AGENT_RUN_STALE_MS,
	held: isHeld,
	claim: interruptOrphan,
	settle: settleConversation,
	publish: publishRunEvents,
	executing: executingRuns,
};

/** Touches the run every `ms` while its job executes; `onLost` when the run was released under it. Returns the stop. */
export function startHeartbeat(
	touch: () => Promise<boolean>,
	onLost: () => void,
	ms = HEARTBEAT_MS,
) {
	const timer = setInterval(
		() =>
			touch().then(
				(held) => held || onLost(),
				() => {},
			),
		ms,
	);
	return () => clearInterval(timer);
}

/**
 * Releases an executing run that lost its worker; true when it did. A fresh
 * heartbeat alone is not proof of life right after a restart (the dead job beat
 * seconds ago), so a run inside the window is also asked for: does a worker hold it?
 */
export async function releaseIfOrphaned(run: RunRow, d: OrphanDeps = orphanDeps) {
	if (run.status !== "executing") return false;
	const stale = Date.now() - run.updatedAt.getTime() > d.staleMs;
	if (!stale && (await d.held(run.id))) return false;
	if (!(await d.claim(run.id))) return false;
	const onError = (error: unknown) => logger.error("[AgentOrphans] release step failed", { error });
	// Calls the dead job left unanswered, while the conversation is still locked.
	await rejectPending(d.store, run.conversationId, run.id, "the server restarted").catch(onError);
	await d.settle(run.conversationId, run.id, "interrupted", "restarted");
	await d
		.publish(run.id, [{ type: "done", seq: -1, status: "interrupted", reason: "restarted" }])
		.catch(onError);
	logger.warn("[AgentOrphans] released a run whose worker is gone", { runId: run.id });
	return true;
}

/** Startup: releases every executing run nobody holds. */
export async function sweepOrphans(d: OrphanDeps = orphanDeps) {
	const rows = await d.executing();
	const done = await Promise.all(
		rows.map((r) =>
			releaseIfOrphaned(r, d).catch((error) => {
				logger.error("[AgentOrphans] sweep failed for a run", { runId: r.id, error });
				return false;
			}),
		),
	);
	return done.filter(Boolean).length;
}

/** The conversation, released first when its run lost its worker (send, approve, stop, open). */
export async function freshConversation(c: Conversation, d: OrphanDeps = orphanDeps) {
	if (c.status !== "running" || !c.activeRunId) return c;
	const run = await getRun(c.activeRunId);
	if (!run || !(await releaseIfOrphaned(run, d))) return c;
	return (await getConversation(c.id)) ?? c;
}

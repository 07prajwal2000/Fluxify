import {
	db,
	agentHarnessConversationsEntity,
	agentHarnessRunsEntity,
	agentHarnessStepsEntity,
	agentHarnessLiveStatesEntity,
	agentHarnessHitlActionsEntity,
	agentHarnessArtifactsEntity,
	agentHarnessSubArtifactsEntity,
} from "@fluxify/server";
import { eq, desc, and } from "drizzle-orm";
import { logger } from "@fluxify/common";
import { HumanMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { GlobalGraphState } from "../types";

export type HitlPlanAction =
	| { type: "approve" }
	| { type: "reject"; message: string }
	| { type: "review"; comments: Array<{ text: string; sectionId?: string; [key: string]: any }> | string[] };

export interface RecordHitlActionInput {
	runId: string;
	stepId?: string;
	action: HitlPlanAction | { type: string; payload?: Record<string, any> };
	background?: boolean;
}

export interface UpsertStepInput {
	id?: string;
	runId: string;
	conversationId?: string;
	stepType: string;
	subAgentRole?: string;
	subAgentId?: string;
	status?: "pending" | "running" | "completed" | "failed" | "interrupted";
	background?: boolean;
}

export interface SaveLiveStateInput {
	runId: string;
	conversationId?: string;
	currentState: "running" | "paused_hitl" | "interrupted" | "completed" | "failed";
	activeStepId?: string;
	graphState?: Partial<GlobalGraphState>;
	workingMemory?: Record<string, any>;
	background?: boolean;
}

export interface UpdateRunInput {
	runId: string;
	aiResponse?: string;
	status?:
		| "queued"
		| "routing"
		| "verifying"
		| "planning"
		| "orchestrating"
		| "executing"
		| "awaiting_hitl"
		| "completed"
		| "interrupted"
		| "failed";
	interruptedAt?: Date | null;
	completedAt?: Date | null;
	background?: boolean;
}

/**
 * Extracts serializable primitives and objects from GlobalGraphState (omitting classes/functions like agentWrapper and internal).
 */
export function extractWorkingMemory(graphState?: Partial<GlobalGraphState>): Record<string, any> {
	if (!graphState) return {};

	const {
		agentWrapper,
		internal,
		messages,
		...serializableState
	} = graphState as any;

	return serializableState;
}

export class HarnessService {
	private conversationId: string;
	private pendingBackgroundPromises: Promise<any>[] = [];

	constructor(conversationId: string) {
		this.conversationId = conversationId;
	}

	public getConversationId(): string {
		return this.conversationId;
	}

	/**
	 * Ensures a conversation row exists for this service's conversationId.
	 * Inserts with the given owner/project if absent, otherwise leaves it as-is.
	 * Used before APIs exist to bootstrap a conversation for a run.
	 */
	async ensureConversation(input: {
		userId?: string;
		projectId?: string;
		title?: string;
		metadata?: Record<string, any>;
	}): Promise<string> {
		try {
			const existing = await db
				.select({ id: agentHarnessConversationsEntity.id })
				.from(agentHarnessConversationsEntity)
				.where(eq(agentHarnessConversationsEntity.id, this.conversationId))
				.limit(1);

			if (existing.length > 0) return existing[0].id;

			const [inserted] = await db
				.insert(agentHarnessConversationsEntity)
				.values({
					id: this.conversationId,
					userId: input.userId,
					projectId: input.projectId,
					title: input.title ?? "New Chat",
					status: "running",
					metadata: input.metadata,
				})
				.returning({ id: agentHarnessConversationsEntity.id });

			logger.info("[HarnessService] Conversation ensured", {
				conversationId: inserted.id,
			});
			return inserted.id;
		} catch (error) {
			logger.error("[HarnessService] Error ensuring conversation", {
				conversationId: this.conversationId,
				error,
			});
			throw error;
		}
	}

	/**
	 * Creates a new run for this conversation and marks it as the active run.
	 * Returns the new runId. The run starts in `queued`.
	 */
	async createRun(input: { userQuery: string }): Promise<string> {
		try {
			const [run] = await db
				.insert(agentHarnessRunsEntity)
				.values({
					conversationId: this.conversationId,
					userQuery: input.userQuery,
					status: "queued",
				})
				.returning({ id: agentHarnessRunsEntity.id });

			await db
				.update(agentHarnessConversationsEntity)
				.set({ activeRunId: run.id, status: "running", updatedAt: new Date() })
				.where(eq(agentHarnessConversationsEntity.id, this.conversationId));

			logger.info("[HarnessService] Run created", {
				runId: run.id,
				conversationId: this.conversationId,
			});
			return run.id;
		} catch (error) {
			logger.error("[HarnessService] Error creating run", {
				conversationId: this.conversationId,
				error,
			});
			throw error;
		}
	}

	/** Updates the conversation-level status. */
	async updateConversationStatus(
		status: "idle" | "running" | "paused_hitl" | "interrupted" | "completed" | "failed",
		activeRunId?: string | null,
	) {
		try {
			await db
				.update(agentHarnessConversationsEntity)
				.set({
					status,
					...(activeRunId !== undefined ? { activeRunId } : {}),
					updatedAt: new Date(),
				})
				.where(eq(agentHarnessConversationsEntity.id, this.conversationId));
		} catch (error) {
			logger.error("[HarnessService] Error updating conversation status", {
				conversationId: this.conversationId,
				status,
				error,
			});
		}
	}

	/**
	 * Creates the parent artifact row for a run (a grouping row linking the run to
	 * its sub-artifacts). Must be created before its sub-artifacts so they can
	 * reference its id. The summary markdown itself is stored on the run
	 * (`aiResponse`), not on the artifact.
	 */
	async createArtifact(input: { runId: string }): Promise<string> {
		const [artifact] = await db
			.insert(agentHarnessArtifactsEntity)
			.values({
				conversationId: this.conversationId,
				runId: input.runId,
			})
			.returning({ id: agentHarnessArtifactsEntity.id });
		return artifact.id;
	}

	/**
	 * Persists a single sub-agent output as a sub-artifact linked to the parent
	 * artifact. Returns the sub-artifact id (referenced by the summary's special
	 * syntax tokens, e.g. @route(subArtifactId=...)).
	 */
	async createSubArtifact(input: {
		artifactId: string;
		runId: string;
		subAgentId?: string;
		kind: string;
		action?: string;
		payload: Record<string, any>;
	}): Promise<string> {
		const [sub] = await db
			.insert(agentHarnessSubArtifactsEntity)
			.values({
				artifactId: input.artifactId,
				conversationId: this.conversationId,
				runId: input.runId,
				subAgentId: input.subAgentId,
				kind: input.kind,
				action: input.action,
				payload: input.payload,
			})
			.returning({ id: agentHarnessSubArtifactsEntity.id });
		return sub.id;
	}

	/**
	 * Loads the persisted working memory for a run (used to rehydrate state when
	 * a parked HITL run is resumed via a `continue` job).
	 */
	async loadWorkingMemory(runId: string): Promise<Record<string, any> | null> {
		try {
			const rows = await db
				.select({ workingMemory: agentHarnessLiveStatesEntity.workingMemory })
				.from(agentHarnessLiveStatesEntity)
				.where(eq(agentHarnessLiveStatesEntity.runId, runId))
				.limit(1);
			return rows.length > 0 ? (rows[0].workingMemory as Record<string, any>) : null;
		} catch (error) {
			logger.error("[HarnessService] Error loading working memory", { runId, error });
			return null;
		}
	}

	/**
	 * Tracks a background promise to ensure it can be safely awaited before graph completion.
	 */
	private trackBackgroundPromise<T>(promise: Promise<T>): void {
		const trackedPromise = promise.catch((error) => {
			logger.error("[HarnessService] Tracked background task error", {
				conversationId: this.conversationId,
				error,
			});
		});

		this.pendingBackgroundPromises.push(trackedPromise);
	}

	/**
	 * Safely awaits all pending background pipelined DB operations to ensure full completion.
	 * Drains iteratively to catch tasks added during a flush cycle.
	 */
	async awaitAllPendingBackgroundTasks(): Promise<void> {
		if (this.pendingBackgroundPromises.length === 0) {
			return;
		}

		logger.info("[HarnessService] Awaiting pending background tasks...", {
			conversationId: this.conversationId,
			count: this.pendingBackgroundPromises.length,
		});

		// Drain iteratively: new tasks may be queued while we await the current batch.
		while (this.pendingBackgroundPromises.length > 0) {
			const tasksToAwait = [...this.pendingBackgroundPromises];
			this.pendingBackgroundPromises = [];
			await Promise.allSettled(tasksToAwait);
		}

		logger.info("[HarnessService] All pending background tasks completed", {
			conversationId: this.conversationId,
		});
	}

	/**
	 * Executes a DB operation with optional background (fire-and-forget) support.
	 * Centralizes the try/catch + background-tracking pattern used by all mutation methods.
	 */
	private async executeWithBackgroundSupport<T>(
		operation: () => Promise<T>,
		isBackground: boolean,
		errorContext: Record<string, any>,
	): Promise<T | null> {
		if (isBackground) {
			this.trackBackgroundPromise(operation());
			return null;
		}

		try {
			return await operation();
		} catch (error) {
			logger.error(`[HarnessService] ${errorContext.operation}`, {
				...errorContext,
				error,
			});
			throw error;
		}
	}

	/**
	 * Fetches the message history for the conversation.
	 * Fetches up to topN (default 5) most recent runs and returns them in chronological order.
	 */
	async getConversationMessageHistory(limit: number = 5): Promise<BaseMessage[]> {
		try {
			const runs = await db
				.select({
					id: agentHarnessRunsEntity.id,
					userQuery: agentHarnessRunsEntity.userQuery,
					aiResponse: agentHarnessRunsEntity.aiResponse,
					status: agentHarnessRunsEntity.status,
					createdAt: agentHarnessRunsEntity.createdAt,
				})
				.from(agentHarnessRunsEntity)
				.where(eq(agentHarnessRunsEntity.conversationId, this.conversationId))
				.orderBy(desc(agentHarnessRunsEntity.createdAt))
				.limit(limit);

			// Reverse so history is ordered chronologically (oldest to newest)
			runs.reverse();

			const messages: BaseMessage[] = [];

			for (const run of runs) {
				if (run.userQuery) {
					messages.push(new HumanMessage(run.userQuery));
				}
				if (run.aiResponse) {
					messages.push(new AIMessage(run.aiResponse));
				}
			}

			return messages;
		} catch (error) {
			logger.error("[HarnessService] Error fetching conversation message history", {
				conversationId: this.conversationId,
				limit,
				error,
			});
			return [];
		}
	}

	/**
	 * Updates an existing run record created when the user initiated the chat request.
	 * Allows updating status, aiResponse markdown, timestamps, etc.
	 */
	async updateRun(input: UpdateRunInput, background: boolean = false) {
		const isBackground = background || Boolean(input.background);

		return this.executeWithBackgroundSupport(
			async () => {
				const updateData: Record<string, any> = {
					updatedAt: new Date(),
				};

				if (input.aiResponse !== undefined) updateData.aiResponse = input.aiResponse;
				if (input.status !== undefined) updateData.status = input.status;
				if (input.interruptedAt !== undefined) updateData.interruptedAt = input.interruptedAt;
				if (input.completedAt !== undefined) updateData.completedAt = input.completedAt;

				const [updated] = await db
					.update(agentHarnessRunsEntity)
					.set(updateData)
					.where(
						and(
							eq(agentHarnessRunsEntity.id, input.runId),
							eq(agentHarnessRunsEntity.conversationId, this.conversationId),
						),
					)
					.returning();

				logger.info("[HarnessService] Run updated", {
					runId: input.runId,
					conversationId: this.conversationId,
					status: input.status,
					background: isBackground,
				});
				return updated;
			},
			isBackground,
			{ operation: "Error updating run", runId: input.runId, conversationId: this.conversationId },
		);
	}

	/**
	 * Upserts an agent harness execution step using PostgreSQL onConflictDoUpdate on composite key (runId, subAgentId).
	 * Pass background = true (or input.background = true) to pipeline/stream DB updates asynchronously in background.
	 */
	async upsertStep(input: UpsertStepInput, background: boolean = false) {
		const isBackground = background || Boolean(input.background);
		const convId = input.conversationId ?? this.conversationId;

		return this.executeWithBackgroundSupport(
			async () => {
				const values = {
					...(input.id ? { id: input.id } : {}),
					runId: input.runId,
					conversationId: convId,
					stepType: input.stepType,
					subAgentRole: input.subAgentRole,
					subAgentId: input.subAgentId,
					status: input.status ?? "pending",
				};

				const [result] = await db
					.insert(agentHarnessStepsEntity)
					.values(values)
					.onConflictDoUpdate({
						target: [
							agentHarnessStepsEntity.runId,
							agentHarnessStepsEntity.subAgentId,
						],
						set: {
							stepType: input.stepType,
							...(input.subAgentRole !== undefined ? { subAgentRole: input.subAgentRole } : {}),
							...(input.status !== undefined ? { status: input.status } : {}),
							updatedAt: new Date(),
						},
					})
					.returning();

				logger.info("[HarnessService] Step upserted", {
					stepId: result?.id,
					runId: input.runId,
					subAgentId: input.subAgentId,
					background: isBackground,
				});
				return result;
			},
			isBackground,
			{ operation: "Error upserting step", input },
		);
	}

	/**
	 * Saves or updates the live working memory state of a run in DB.
	 * Uses onConflictDoUpdate on runId (primary key).
	 * If background is true, runs asynchronously in non-blocking mode.
	 */
	async saveLiveState(input: SaveLiveStateInput, background: boolean = false) {
		const isBackground = background || Boolean(input.background);
		const convId = input.conversationId ?? this.conversationId;

		return this.executeWithBackgroundSupport(
			async () => {
				const workingMemory =
					input.workingMemory ?? extractWorkingMemory(input.graphState);

				const [result] = await db
					.insert(agentHarnessLiveStatesEntity)
					.values({
						runId: input.runId,
						conversationId: convId,
						currentState: input.currentState,
						activeStepId: input.activeStepId,
						workingMemory,
					})
					.onConflictDoUpdate({
						target: agentHarnessLiveStatesEntity.runId,
						set: {
							currentState: input.currentState,
							...(input.activeStepId !== undefined
								? { activeStepId: input.activeStepId }
								: {}),
							workingMemory,
							updatedAt: new Date(),
						},
					})
					.returning();

				logger.info("[HarnessService] Live state saved", {
					runId: input.runId,
					currentState: input.currentState,
					background: isBackground,
				});
				return result;
			},
			isBackground,
			{ operation: "Error saving live state", runId: input.runId },
		);
	}

	/**
	 * Records a Human-In-The-Loop (HITL) action taken by the user.
	 * Supports plan review actions: approve (no metadata), reject (message), review (comments array).
	 */
	async recordHitlAction(input: RecordHitlActionInput, background: boolean = false) {
		const isBackground = background || Boolean(input.background);

		return this.executeWithBackgroundSupport(
			async () => {
				const { actionType, userResponse } = this.resolveHitlAction(input.action);

				const [inserted] = await db
					.insert(agentHarnessHitlActionsEntity)
					.values({
						runId: input.runId,
						stepId: input.stepId,
						actionType,
						userResponse,
					})
					.returning();

				logger.info("[HarnessService] HITL action recorded", {
					actionId: inserted.id,
					runId: input.runId,
					actionType,
					background: isBackground,
				});
				return inserted;
			},
			isBackground,
			{ operation: "Error recording HITL action", input },
		);
	}

	/**
	 * Maps a HitlPlanAction union to DB-level actionType + userResponse.
	 * Uses proper discriminated union narrowing instead of `as any` casts.
	 */
	private resolveHitlAction(action: RecordHitlActionInput["action"]): {
		actionType: "plan_approval" | "plan_rejection" | "user_input" | "confirmation" | "cancellation" | "custom";
		userResponse: Record<string, any> | null;
	} {
		switch (action.type) {
			case "approve":
				return { actionType: "plan_approval", userResponse: null };
			case "reject":
				return {
					actionType: "plan_rejection",
					userResponse: { message: (action as HitlPlanAction & { type: "reject" }).message ?? "" },
				};
			case "review":
				return {
					actionType: "user_input",
					userResponse: { comments: (action as HitlPlanAction & { type: "review" }).comments ?? [] },
				};
			default: {
				const generic = action as { type: string; payload?: Record<string, any> };
				return {
					actionType: (generic.type as any) ?? "custom",
					userResponse: generic.payload ?? null,
				};
			}
		}
	}
}

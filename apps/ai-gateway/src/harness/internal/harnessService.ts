import {
	db,
	agentHarnessRunsEntity,
	agentHarnessStepsEntity,
	agentHarnessLiveStatesEntity,
	agentHarnessHitlActionsEntity,
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
	 * Flushes the tracking array upon completion.
	 */
	async awaitAllPendingBackgroundTasks(): Promise<void> {
		if (this.pendingBackgroundPromises.length === 0) {
			return;
		}

		logger.info("[HarnessService] Awaiting pending background tasks...", {
			conversationId: this.conversationId,
			count: this.pendingBackgroundPromises.length,
		});

		const tasksToAwait = [...this.pendingBackgroundPromises];
		this.pendingBackgroundPromises = [];

		await Promise.allSettled(tasksToAwait);

		logger.info("[HarnessService] All pending background tasks completed", {
			conversationId: this.conversationId,
		});
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

		const executeUpdate = async () => {
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
		};

		if (isBackground) {
			this.trackBackgroundPromise(executeUpdate());
			return null;
		}

		try {
			return await executeUpdate();
		} catch (error) {
			logger.error("[HarnessService] Error updating run", {
				runId: input.runId,
				conversationId: this.conversationId,
				error,
			});
			throw error;
		}
	}

	/**
	 * Upserts an agent harness execution step using PostgreSQL onConflictDoUpdate on composite key (runId, subAgentId).
	 * Pass background = true (or input.background = true) to pipeline/stream DB updates asynchronously in background.
	 */
	async upsertStep(input: UpsertStepInput, background: boolean = false) {
		const isBackground = background || Boolean(input.background);
		const convId = input.conversationId ?? this.conversationId;

		const executeUpsert = async () => {
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
		};

		if (isBackground) {
			this.trackBackgroundPromise(executeUpsert());
			return null;
		}

		try {
			return await executeUpsert();
		} catch (error) {
			logger.error("[HarnessService] Error upserting step", {
				input,
				error,
			});
			throw error;
		}
	}

	/**
	 * Saves or updates the live working memory state of a run in DB.
	 * Uses onConflictDoUpdate on runId (primary key).
	 * If background is true, runs asynchronously in non-blocking mode.
	 */
	async saveLiveState(input: SaveLiveStateInput, background: boolean = false) {
		const isBackground = background || Boolean(input.background);
		const convId = input.conversationId ?? this.conversationId;

		const executeSave = async () => {
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
		};

		if (isBackground) {
			this.trackBackgroundPromise(executeSave());
			return null;
		}

		try {
			return await executeSave();
		} catch (error) {
			logger.error("[HarnessService] Error saving live state", {
				runId: input.runId,
				error,
			});
			throw error;
		}
	}

	/**
	 * Records a Human-In-The-Loop (HITL) action taken by the user.
	 * Supports plan review actions: approve (no metadata), reject (message), review (comments array).
	 */
	async recordHitlAction(input: RecordHitlActionInput, background: boolean = false) {
		const isBackground = background || Boolean(input.background);

		const executeRecord = async () => {
			let actionType:
				| "plan_approval"
				| "plan_rejection"
				| "user_input"
				| "confirmation"
				| "cancellation"
				| "custom";
			let userResponse: Record<string, any> | null = null;

			const action = input.action;
			if (action.type === "approve") {
				actionType = "plan_approval";
				userResponse = null;
			} else if (action.type === "reject") {
				actionType = "plan_rejection";
				userResponse = { message: (action as any).message || "" };
			} else if (action.type === "review") {
				actionType = "user_input";
				userResponse = { comments: (action as any).comments || [] };
			} else {
				actionType = (action.type as any) || "custom";
				userResponse = (action as any).payload ?? null;
			}

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
		};

		if (isBackground) {
			this.trackBackgroundPromise(executeRecord());
			return null;
		}

		try {
			return await executeRecord();
		} catch (error) {
			logger.error("[HarnessService] Error recording HITL action", {
				input,
				error,
			});
			throw error;
		}
	}
}

import {
	db,
	agentHarnessCompactionsEntity,
	agentHarnessRunsEntity,
} from "@fluxify/server";
import { logger } from "@fluxify/common";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
	expectedCompactionBlocks,
	HISTORY_VALIDATION_TURNS,
	isValidCompaction,
	latestCompactionBlock,
	RAW_HISTORY_TURNS,
	sourceDigest,
	totalTokenIo,
	type HistoryCompaction,
	type HistoryRun,
	type TokenIo,
} from "./historyCompaction";

export interface SaveHistoryCompactionInput {
	summary: string;
	sourceRuns: HistoryRun[];
	compactionUsage: TokenIo;
}

export class HistoryRepository {
	constructor(private readonly conversationId: string) {}

	private async completedWindow(): Promise<{
		totalRuns: number;
		runs: HistoryRun[];
	}> {
		const where = and(
			eq(agentHarnessRunsEntity.conversationId, this.conversationId),
			eq(agentHarnessRunsEntity.status, "completed"),
			isNotNull(agentHarnessRunsEntity.aiResponse),
		);
		const [totals, runs] = await Promise.all([
			db.select({ value: count() }).from(agentHarnessRunsEntity).where(where),
			db
				.select({
					id: agentHarnessRunsEntity.id,
					userQuery: agentHarnessRunsEntity.userQuery,
					aiResponse: agentHarnessRunsEntity.aiResponse,
					usage: agentHarnessRunsEntity.usage,
					createdAt: agentHarnessRunsEntity.createdAt,
				})
				.from(agentHarnessRunsEntity)
				.where(where)
				.orderBy(
					desc(agentHarnessRunsEntity.createdAt),
					desc(agentHarnessRunsEntity.id),
				)
				.limit(HISTORY_VALIDATION_TURNS),
		]);
		return {
			totalRuns: Number(totals[0]?.value ?? 0),
			runs: runs.reverse(),
		};
	}

	private async storedCompactions(
		expectedEndIds: string[],
	): Promise<HistoryCompaction[]> {
		if (expectedEndIds.length === 0) return [];
		try {
			return (await db
				.select({
					id: agentHarnessCompactionsEntity.id,
					summary: agentHarnessCompactionsEntity.summary,
					sourceRunIds: agentHarnessCompactionsEntity.sourceRunIds,
					sourceStartRunId:
						agentHarnessCompactionsEntity.sourceStartRunId,
					sourceEndRunId: agentHarnessCompactionsEntity.sourceEndRunId,
					sourceDigest: agentHarnessCompactionsEntity.sourceDigest,
					sourceInputTokens:
						agentHarnessCompactionsEntity.sourceInputTokens,
					sourceOutputTokens:
						agentHarnessCompactionsEntity.sourceOutputTokens,
				})
				.from(agentHarnessCompactionsEntity)
				.where(
					and(
						eq(
							agentHarnessCompactionsEntity.conversationId,
							this.conversationId,
						),
						inArray(
							agentHarnessCompactionsEntity.sourceEndRunId,
							expectedEndIds,
						),
					),
				)) as HistoryCompaction[];
		} catch (error) {
			logger.warn("[HistoryRepository] Compactions unavailable; using raw turns", {
				conversationId: this.conversationId,
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	}

	/** Five raw completed turns plus verified non-overlapping summaries. */
	async messages(): Promise<BaseMessage[]> {
		const { totalRuns, runs } = await this.completedWindow();
		const expectedBlocks = expectedCompactionBlocks(runs, totalRuns);
		const stored = await this.storedCompactions(
			expectedBlocks.map((block) => block.at(-1)!.id),
		);
		const byEndId = new Map(stored.map((item) => [item.sourceEndRunId, item]));
		const summaries: string[] = [];

		for (const block of expectedBlocks) {
			const compaction = byEndId.get(block.at(-1)!.id);
			if (!compaction) continue;
			if (!isValidCompaction(compaction, block)) {
				logger.warn("[HistoryRepository] Ignoring invalid compaction", {
					conversationId: this.conversationId,
					compactionId: compaction.id,
					sourceEndRunId: compaction.sourceEndRunId,
				});
				continue;
			}
			summaries.push(compaction.summary.trim());
		}

		const messages: BaseMessage[] = [];
		if (summaries.length > 0) {
			messages.push(
				new HumanMessage(
					"Earlier conversation context was compacted into these verified blocks:",
				),
				new AIMessage(
					summaries
						.map(
							(summary, index) =>
								`## Compacted block ${index + 1}\n${summary}`,
						)
						.join("\n\n"),
				),
			);
		}
		for (const run of runs.slice(-RAW_HISTORY_TURNS)) {
			messages.push(new HumanMessage(run.userQuery));
			if (run.aiResponse) messages.push(new AIMessage(run.aiResponse));
		}
		return messages;
	}

	async eligibleBlock(): Promise<HistoryRun[] | undefined> {
		const { totalRuns, runs } = await this.completedWindow();
		const block = latestCompactionBlock(runs, totalRuns);
		if (!block) return undefined;
		const existing = await db
			.select({ id: agentHarnessCompactionsEntity.id })
			.from(agentHarnessCompactionsEntity)
			.where(
				and(
					eq(
						agentHarnessCompactionsEntity.conversationId,
						this.conversationId,
					),
					eq(
						agentHarnessCompactionsEntity.sourceEndRunId,
						block.at(-1)!.id,
					),
				),
			)
			.limit(1);
		return existing.length === 0 ? block : undefined;
	}

	async save(input: SaveHistoryCompactionInput): Promise<void> {
		const sourceUsage = totalTokenIo(input.sourceRuns);
		await db
			.insert(agentHarnessCompactionsEntity)
			.values({
				conversationId: this.conversationId,
				summary: input.summary,
				sourceRunIds: input.sourceRuns.map((run) => run.id),
				sourceStartRunId: input.sourceRuns[0]!.id,
				sourceEndRunId: input.sourceRuns.at(-1)!.id,
				sourceDigest: sourceDigest(input.sourceRuns),
				sourceInputTokens: sourceUsage.inputTokens,
				sourceOutputTokens: sourceUsage.outputTokens,
				compactionInputTokens: input.compactionUsage.inputTokens,
				compactionOutputTokens: input.compactionUsage.outputTokens,
			})
			.onConflictDoNothing();
	}
}

import { logger } from "@fluxify/common";
import type { AgentFactory } from "../models/factory";
import { RunBudget } from "../models/budget";
import { extractText } from "../models/jsonUtils";
import { enforceTokenAllowlist } from "../agents/summarizerTokens";
import {
	COMPACTION_SYSTEM_PROMPT,
	compactionPrompt,
	preservesReferenceTokens,
	referenceTokens,
	tokenIo,
} from "./historyCompaction";
import type { HarnessService } from "./harnessService";

/** Best-effort checkpoint creation. Raw runs remain authoritative on every
 * model, validation, timeout, or storage failure. */
export async function compactCompletedHistory(
	agentFactory: AgentFactory,
	harnessService: HarnessService,
): Promise<void> {
	try {
		const sourceRuns = await harnessService.getEligibleHistoryCompactionBlock();
		if (!sourceRuns) return;

		const budget = new RunBudget({
			deadlineMs: Number(
				process.env.HARNESS_COMPACTION_DEADLINE_MS ?? 60_000,
			),
			tokenBudget: 0,
		});
		const agent = agentFactory.createAgent();
		agent.setRunBudget(budget);
		const response = await agent.invokeAgent<never>({
			agentNode: "historyCompaction",
			systemPrompt: COMPACTION_SYSTEM_PROMPT,
			context: compactionPrompt(sourceRuns),
			userQuery: "Write the compacted conversation context now.",
		});
		const allowedTokens = referenceTokens(sourceRuns);
		const summary = enforceTokenAllowlist(
			extractText(response).trim(),
			allowedTokens,
		);
		if (!summary) throw new Error("Compaction model returned an empty summary");
		if (!preservesReferenceTokens(summary, allowedTokens)) {
			throw new Error("Compaction model dropped an artifact reference");
		}

		await harnessService.saveHistoryCompaction({
			summary,
			sourceRuns,
			compactionUsage: tokenIo(budget.snapshot()),
		});
	} catch (error) {
		logger.warn("[HistoryCompactor] Compaction skipped", {
			conversationId: harnessService.getConversationId(),
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

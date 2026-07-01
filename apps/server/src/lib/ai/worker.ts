import { subscribeToChannel, CHAN_AI_WORKER } from "../../db/redis";
import { db } from "../../db";
import {
	routesEntity,
	projectSettingsEntity,
	aiChatEntity,
	integrationsEntity,
} from "../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { AiChatTracker } from "./tracker";
import { aiAgentGraph } from "../ai";
import { ToolsContext } from "./schemas";
import { AIMessage, HumanMessage } from "langchain";
import { estimateTokenCount } from "tokenx";
import { ProjectSettingsKeyType } from "../../api/v1/projects/settings/keys/keySchemaMap";
import { AIAdapterFactory } from "./factory";
import { appConfigCache } from "../../loaders/appconfigLoader";
import {
	loadCanvasItems,
	loadIntegrationsList,
	loadConfigsList,
} from "./worker-loaders";
import { logger } from "better-auth";

export async function startAiWorker() {
	logger.info("[AI Worker] Listening for messages...");

	subscribeToChannel(CHAN_AI_WORKER, async (dataStr) => {
		try {
			if (process.env.ENABLE_AI !== "true") return;

			const data = JSON.parse(dataStr);
			const { messageId, userMessageId, routeId, userId, content } = data;

			await processAiMessage(
				messageId,
				userMessageId,
				routeId,
				userId,
				content,
			);
		} catch (error) {
			console.error("[AI Worker] Error processing message:", error);
		}
	});
}

async function processAiMessage(
	messageId: string,
	userMessageId: string,
	routeId: string,
	userId: string,
	content: string,
) {
	const tracker = new AiChatTracker(messageId, routeId, userId);

	try {
		await tracker.update(1, "started", "Init");

		// Fetch route and project settings (checking AI connector)
		const routeResult = await db
			.select({
				projectId: routesEntity.projectId,
				route: routesEntity,
				aiConnector: projectSettingsEntity.value,
			})
			.from(routesEntity)
			.leftJoin(
				projectSettingsEntity,
				and(
					eq(projectSettingsEntity.projectId, routesEntity.projectId!),
					eq(
						projectSettingsEntity.key,
						"settings.ai.agentConnectionId" as ProjectSettingsKeyType,
					),
				),
			)
			.where(eq(routesEntity.id, routeId))
			.limit(1);

		if (routeResult.length === 0 || !routeResult[0].aiConnector) {
			await tracker.update(
				-1,
				"error",
				"Init",
				undefined,
				"No AI connector or route found",
			);
			return;
		}

		// Fetch the connector config
		const [connector] = await db
			.select()
			.from(integrationsEntity)
			.where(eq(integrationsEntity.id, routeResult[0].aiConnector))
			.limit(1);

		if (!connector || !connector.config) {
			await tracker.update(
				-1,
				"error",
				"Init",
				undefined,
				"Invalid AI connector",
			);
			return;
		}

		const rawConfig = connector.config as Record<string, any>;
		const aiConfig: Record<string, any> = {};
		for (const key in rawConfig) {
			const value = rawConfig[key];
			if (typeof value === "string" && value.startsWith("cfg:")) {
				aiConfig[key] = appConfigCache[value.slice(4)];
			} else {
				aiConfig[key] = value;
			}
		}

		const modelFactory = AIAdapterFactory.CreateAdapter(
			connector.variant as any,
			aiConfig,
		);

		// Fetch historical messages: limited to max 2 recent pair ai-human messages
		const pastMessages = await db
			.select()
			.from(aiChatEntity)
			.where(
				and(eq(aiChatEntity.routeId, routeId), eq(aiChatEntity.userId, userId)),
			)
			.orderBy(desc(aiChatEntity.createdAt))
			.limit(5); // latest 5. we only send up to 2 context pairs

		const langgraphMessages: any[] = [];
		const pairsNeeded = 2; // max 2 ai-human pairs (4 messages total)
		let pairsAdded = 0;

		for (const msg of pastMessages) {
			// skip the current two messages we just created (user prompt & pending ai prompt)
			if (msg.id === messageId || msg.id === userMessageId) {
				continue;
			}
			if (pairsAdded >= pairsNeeded * 2) break;

			if (msg.role === "user" && msg.content) {
				langgraphMessages.unshift(new HumanMessage(msg.content));
				pairsAdded++;
			} else if (msg.role === "ai" && msg.content) {
				langgraphMessages.unshift(new AIMessage(msg.content));
				pairsAdded++;
			}
		}

		// Calculate Input Tokens
		let inputTokens = estimateTokenCount(content) || 0;
		for (const msg of langgraphMessages) {
			inputTokens += estimateTokenCount(msg.content as string) || 0;
		}

		const toolsCtx = new Set<string>();

		const projectId = routeResult[0].projectId ?? "";

		// Load canvas items, integrations and configs in parallel
		const [canvasItems, integrationsList, configsList] = await Promise.all([
			loadCanvasItems(routeId),
			loadIntegrationsList(projectId),
			loadConfigsList(),
		]);

		const result = await aiAgentGraph.invoke(
			{
				modelFactory,
				userPrompt: content,
				buildMode: {},
				clarificationQuestion: "",
				classifierOutput: { intent: "DISCUSSION", reasoning: "" },
				messages: langgraphMessages,
				tracker,
				metadata: {
					integrationsList,
					configsList,
					route: {
						id: routeResult[0].route.id,
						name: routeResult[0].route.name || "Unknown",
						method: routeResult[0].route.method || "GET",
						path: routeResult[0].route.path || "/",
						canvasItems,
					},
					userId,
				},
			},
			{ context: { toolCalls: toolsCtx } satisfies ToolsContext },
		);

		let aiResponseContent = "";
		if (
			result.classifierOutput.intent === "DISCUSSION" &&
			result.discussionMode?.output
		) {
			aiResponseContent = result.discussionMode.output;
		} else if (result.buildMode?.builderOutput?.reasoning) {
			aiResponseContent = `Built successful: ${result.buildMode.builderOutput.reasoning}`;
		} else if (result.buildMode?.plannerOutput?.status === "impossible") {
			aiResponseContent =
				result.buildMode.plannerOutput.clarificationQuestion ||
				"Impossible build plan.";
		}

		const outputTokens = estimateTokenCount(aiResponseContent) || 0;
		const totalTokens = inputTokens + outputTokens;

		// Final updates to DB
		await db
			.update(aiChatEntity)
			.set({
				content: aiResponseContent,
				aiResponse: {
					classifierOutput: result.classifierOutput,
					discussionOutput: result.discussionMode,
					plannerOutput: result.buildMode?.plannerOutput,
					builderOutput: result.buildMode?.builderOutput,
				},
				messageStage: 4,
				actionState: 0,
				toolCalls: Array.from(toolsCtx),
				tokenUsage: totalTokens,
			})
			.where(eq(aiChatEntity.id, messageId));

		await tracker.update(4, "success", "Completed");
	} catch (err: any) {
		console.error("[AI Worker Error]", err);
		await tracker.update(
			-1,
			"error",
			"Failed",
			undefined,
			err?.message || "Internal Worker Error",
		);
	}
}

import { subscribeToChannel, CHAN_AI_WORKER } from "../../db/redis";
import { db } from "../../db";
import {
	routesEntity,
	projectSettingsEntity,
	integrationsEntity,
} from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { AiChatTracker } from "./tracker";
import { aiAgentGraph } from "../ai";
import { ToolsContext } from "./schemas";
import { estimateTokenCount } from "tokenx";
import { ProjectSettingsKeyType } from "../../api/v1/projects/settings/keys/keySchemaMap";
import { AIAdapterFactory } from "./factory";
import { getAppConfig } from "../../loaders/appconfigLoader";
import {
	loadCanvasItems,
	loadIntegrationsList,
	loadConfigsList,
} from "./worker-loaders";


export async function startAiWorker() {
	console.log("[AI Worker] Listening for messages...");

	subscribeToChannel(CHAN_AI_WORKER, async (dataStr) => {
		try {
			if (process.env.ENABLE_AI !== "true") return;

			const data = JSON.parse(dataStr);
			const { messageId, routeId, userId, content } = data;

			await processAiMessage(messageId, routeId, userId, content);
		} catch (error) {
			console.error("[AI Worker] Error processing message:", error);
		}
	});
}

async function processAiMessage(
	messageId: string,
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
		const projectId = routeResult[0].projectId!;

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
				aiConfig[key] = getAppConfig(projectId!, value.slice(4));
			} else {
				aiConfig[key] = value;
			}
		}

		const modelFactory = AIAdapterFactory.CreateAdapter(
			connector.variant as any,
			aiConfig,
		);

		// Calculate Input Tokens
		const inputTokens = estimateTokenCount(content) || 0;

		const toolsCtx = new Set<string>();

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
				messages: [],
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
		console.log(`[AI Worker] Completed. Total tokens: ${totalTokens}`);

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

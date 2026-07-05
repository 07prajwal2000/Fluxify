import { Workflow } from "../ai";
import type { WorkflowMetadata, ModelFactory } from "../ai";
import { REDIS_HOST, REDIS_PORT, REDIS_PASS, REDIS_USER } from "../lib/env";
import { ClassifierNode, type ClassifierParams } from "./nodes/classifier";
import { DiscussionNode, type DiscussionParams } from "./nodes/discussion";
import { createWorkflowTools } from "./tools";
import { logger } from "@fluxify/common";
import { generateText, type LanguageModel } from "ai";
import {
	type AIWorkflowGatewayData,
	type ConversationWorkflowStatus,
	WORKER_QUEUE_NAME,
} from "./queue";
import { Job, Worker } from "bullmq";
import { createAIModelInstanceFromProjectId } from "./model-factory";
import {
	aiChatHistoryEntity,
	db,
	deleteCacheKey,
	setCache,
	aiChatConversationsEntity,
	deleteCacheKeysByPattern,
} from "@fluxify/server";
import { eq } from "drizzle-orm";

// Define the NodeRegistry for type safety across the workflow
export interface AIWorkflowRegistry {
	classifier: ClassifierParams;
	discussion: DiscussionParams; // Stub for discussion agent
	builder: any; // Stub for builder agent
}

// Track active workflows in memory
const activeWorkflows = new Map<string, Workflow<AIWorkflowRegistry>>();

export interface RunWorkflowParams {
	metadata: WorkflowMetadata;
	initialQuery: string;
	modelFactory: ModelFactory;
	model: LanguageModel; // Needed for the classifier execution
	job: Job<AIWorkflowGatewayData>;
}

/**
 * Initializes and schedules an AI Workflow in the background.
 */
export async function runAIWorkflow(params: RunWorkflowParams) {
	const { metadata, initialQuery, modelFactory, model, job } = params;
	const { conversationId } = metadata;

	if (activeWorkflows.has(conversationId)) {
		return { conversationId, status: "already_running" };
	}

	await deleteCacheKeysByPattern(
		`conversations:list_messages:${conversationId}:*`,
	);
	await deleteCacheKeysByPattern(`conversations:list:${metadata.projectId}:*`);

	// Initialize the workflow
	const workflow = new Workflow<AIWorkflowRegistry>(metadata);
	const conversationStatus: ConversationWorkflowStatus = {
		status: "started",
		conversationId,
		userQuery: initialQuery,
		currentNodeId: "classifier",
		executionHistory: [],
	};

	// Register all workflow-level tools
	const workflowTools = createWorkflowTools(metadata);
	for (const [toolName, tool] of Object.entries(workflowTools)) {
		workflow.registerTool(toolName, tool);
	}
	await trackConversationStatus(conversationId, conversationStatus, job);
	// Instantiate and register nodes
	const classifierNode = new ClassifierNode(modelFactory);
	const discussionNode = new DiscussionNode(modelFactory);
	workflow.addNode(classifierNode);
	workflow.addNode(discussionNode);
	// workflow.addNode(new BuilderNode(...));

	workflow.onNodeEnter(async (nodeId, input) => {
		conversationStatus.status = "running";
		conversationStatus.currentNodeId = nodeId;
		conversationStatus.executionHistory.push({
			name: nodeId,
			status: "running",
			type: "node",
			input,
		});
		await trackConversationStatus(conversationId, conversationStatus, job);
	});

	workflow.onNodeSuccess(async (nodeId, input, output) => {
		conversationStatus.currentNodeId = nodeId;
		conversationStatus.executionHistory.push({
			name: nodeId,
			status: "success",
			type: "node",
			input,
			output,
		});
		await trackConversationStatus(conversationId, conversationStatus, job);
	});

	workflow.onNodeFailure(async (nodeId, input, error) => {
		conversationStatus.executionHistory.push({
			name: nodeId,
			status: "failure",
			type: "node",
			input,
			output: error,
		});
		await trackConversationStatus(conversationId, conversationStatus, job);
	});

	workflow.onToolExecution(async (toolName, input, output) => {
		conversationStatus.executionHistory.push({
			name: toolName,
			status: "success",
			type: "tool",
			input,
			output,
		});
		await trackConversationStatus(conversationId, conversationStatus, job);
	});

	// Track the workflow in the active map
	activeWorkflows.set(conversationId, workflow);

	// Schedule the workflow in the background (fire and forget)
	try {
		// Start the workflow from the classifier node
		const finalResult = await workflow.start("classifier", {
			query: initialQuery,
			messageHistory: metadata.messageHistory,
			model,
		});
		conversationStatus.status = "completed";
		conversationStatus.finalResult = finalResult;
	} catch (error) {
		logger.error(`[Workflow] Error in conversation: ${conversationId}`, {
			error,
		});
		conversationStatus.status = "error";
		conversationStatus.finalResult = `Error occured while running the agent`;
	} finally {
		// Clean up the active workflow map upon completion or failure
		await trackConversationStatus(
			conversationId,
			conversationStatus,
			job,
			true,
		);
		await saveConversationStatus(conversationStatus);
		activeWorkflows.delete(conversationId);

		await deleteCacheKeysByPattern(
			`conversations:list_messages:${conversationId}:*`,
		);
		await deleteCacheKeysByPattern(
			`conversations:list:${metadata.projectId}:*`,
		);
	}

	return { conversationId, status: "started" };
}

export function initializeAIWorkflow() {
	const workflowWorker = new Worker<AIWorkflowGatewayData>(
		WORKER_QUEUE_NAME,
		async (job) => {
			const { conversationId, userQuery } = job.data.data;

			const conversation = await db
				.select()
				.from(aiChatConversationsEntity)
				.where(eq(aiChatConversationsEntity.id, conversationId))
				.then((res: any) => res[0]);

			if (!conversation) {
				throw new Error(`Conversation ${conversationId} not found`);
			}

			const projectId = conversation.projectId;
			const userId = conversation.userId;
			const routeId = conversation.metadata.routeId || "none";
			const location = conversation.metadata.location;

			const modelInstance = await createAIModelInstanceFromProjectId(projectId);

			await runAIWorkflow({
				job,
				initialQuery: userQuery,
				metadata: {
					conversationId,
					location,
					projectId,
					routeId,
					userId,
					messageHistory: [], // TODO: fetch history if continue
				},
				modelFactory: async (config) => {
					return (runtimeConfig) => {
						return generateText({
							...config,
							...runtimeConfig,
							model: modelInstance,
						});
					};
				},
				model: modelInstance!,
			});
		},
		{
			connection: {
				host: REDIS_HOST,
				port: parseInt(REDIS_PORT),
				password: REDIS_PASS,
				username: REDIS_USER,
			},
		},
	);
}

export async function trackConversationStatus(
	conversationId: string,
	status: ConversationWorkflowStatus,
	job: Job<AIWorkflowGatewayData>,
	deleteCache?: boolean,
) {
	const key = getConversationKey(conversationId);

	await job.updateProgress(status);
	if (deleteCache === true) await deleteCacheKey(key);
	else await setCache(key, JSON.stringify({ status }));
}

export function getConversationKey(conversationId: string): string {
	return `workflow:${conversationId}`;
}

export async function saveConversationStatus(
	status: ConversationWorkflowStatus,
) {
	await db.insert(aiChatHistoryEntity).values({
		conversationId: status.conversationId,
		userQuery: status.userQuery,
		status: "completed",
		finalOutput: {
			nodeId: status.currentNodeId,
			result: status.finalResult,
		},
		workflowExecutionHistory: status.executionHistory.map((history) => ({
			type: history.type,
			id: history.name,
			status: history.status,
			input: history.input,
			output: history.output,
		})),
	});
}

// Re-export nodes for external use if necessary
export * from "./nodes/classifier";
export * from "./nodes/discussion";

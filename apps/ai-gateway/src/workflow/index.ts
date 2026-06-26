import { Workflow } from "../ai";
import type { WorkflowMetadata, ModelFactory } from "../ai";
import { REDIS_HOST, REDIS_PORT, REDIS_PASS, REDIS_USER } from "../lib/env";
import { ClassifierNode, type ClassifierParams } from "./nodes/classifier";
import { DiscussionNode, type DiscussionParams } from "./nodes/discussion";
import { createWorkflowTools } from "./tools";
import { logger } from "@fluxify/common";
import { generateText, type LanguageModel } from "ai";
import { type AIWorkflowGatewayData, WORKER_QUEUE_NAME } from "./queue";
import { Job, Worker } from "bullmq";
import { createAIModelInstanceFromProjectId } from "./model-factory";

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
export function runAIWorkflow(params: RunWorkflowParams) {
	const { metadata, initialQuery, modelFactory, model } = params;
	const { conversationId } = metadata;

	if (activeWorkflows.has(conversationId)) {
		logger.warn(
			`Workflow for conversation ${conversationId} is already running.`,
		);
		return { conversationId, status: "already_running" };
	}

	logger.info(`Starting AI Workflow for conversation: ${conversationId}`);

	// Initialize the workflow
	const workflow = new Workflow<AIWorkflowRegistry>(metadata);

	// Register all workflow-level tools
	const workflowTools = createWorkflowTools(metadata);
	for (const [toolName, tool] of Object.entries(workflowTools)) {
		workflow.registerTool(toolName, tool);
	}

	// Instantiate and register nodes
	const classifierNode = new ClassifierNode(modelFactory);
	const discussionNode = new DiscussionNode(modelFactory);
	workflow.addNode(classifierNode);
	workflow.addNode(discussionNode);
	// workflow.addNode(new BuilderNode(...));

	// Setup empty callbacks with logger
	workflow.onNodeSuccess(async (nodeId, input, output) => {
		logger.info(`[Workflow] Node ${nodeId} succeeded`, { output });
	});

	workflow.onNodeFailure(async (nodeId, input, error) => {
		logger.error(`[Workflow] Node ${nodeId} failed`, { error });
	});

	workflow.onToolExecution(async (toolName, input, output) => {
		logger.info(`[Workflow] Tool ${toolName} executed`);
	});

	// Track the workflow in the active map
	activeWorkflows.set(conversationId, workflow);

	// Schedule the workflow in the background (fire and forget)
	(async () => {
		try {
			// Start the workflow from the classifier node
			const finalResult = await workflow.start("classifier", {
				query: initialQuery,
				messageHistory: metadata.messageHistory,
				model,
			});

			logger.info(`[Workflow] Completed for conversation: ${conversationId}`, {
				finalResult,
			});
		} catch (error) {
			logger.error(`[Workflow] Error in conversation: ${conversationId}`, {
				error,
			});
		} finally {
			// Clean up the active workflow map upon completion or failure
			activeWorkflows.delete(conversationId);
			logger.info(`[Workflow] Removed from active map: ${conversationId}`);
		}
	})();

	return { conversationId, status: "started" };
}

export function initializeAIWorkflow() {
	const workflowWorker = new Worker<AIWorkflowGatewayData>(
		WORKER_QUEUE_NAME,
		async (job) => {
			const { location, projectId, routeId, userId, userQuery } = job.data.data;
			const conversationId = buildConversationId(
				userId,
				routeId,
				projectId,
				location,
			);
			const modelInstance = await createAIModelInstanceFromProjectId(projectId);
			runAIWorkflow({
				job,
				initialQuery: userQuery,
				metadata: {
					conversationId,
					location,
					projectId,
					routeId,
					userId,
					messageHistory: [],
				},
				modelFactory: async (config) => {
					return (runtimeConfig) =>
						generateText({
							...config,
							...runtimeConfig,
							model: modelInstance,
						});
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

export function buildConversationId(
	userId: string,
	routeId: string,
	projectId: string,
	location: string,
) {
	return `${userId}-${routeId}-${projectId}-${location}`;
}

// Re-export nodes for external use if necessary
export * from "./nodes/classifier";
export * from "./nodes/discussion";

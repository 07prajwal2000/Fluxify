import { Workflow } from "../ai";
import type { WorkflowMetadata, ModelFactory } from "../ai";
import { REDIS_HOST, REDIS_PORT, REDIS_PASS, REDIS_USER } from "../lib/env";
import { ClassifierNode, type ClassifierParams } from "./nodes/classifier";
import { DiscussionNode, type DiscussionParams } from "./nodes/discussion";
import {
	BuilderEntryNode,
	type BuilderEntryParams,
} from "./nodes/builder/builderEntry";
import {
	VerifyUserQueryNode,
	type VerifyUserQueryParams,
} from "./nodes/builder/verifyUserQuery";
import { PlannerNode, type PlannerParams } from "./nodes/builder/plannerNode";
import { createWorkflowTools } from "./tools";
import { logger } from "@fluxify/common";
import { generateText, type LanguageModel } from "ai";
import {
	type AIWorkflowGatewayData,
	type ConversationWorkflowStatus,
	WORKER_QUEUE_NAME,
	CONTINUE_WORKFLOW_JOB_NAME,
} from "./queue";
import { Job, Worker } from "bullmq";
import { createAIModelInstanceFromProjectId } from "./model-factory";
import {
	trackConversationStatus,
	saveConversationStatus,
	invalidateConversationCaches,
	fetchConversation,
	fetchLastBuilderStep,
	getConversationKey,
} from "./workflowService";

// Re-export so external consumers don't break
export { getConversationKey, trackConversationStatus };

// Define the NodeRegistry for type safety across the workflow
export interface AIWorkflowRegistry {
	classifier: ClassifierParams;
	discussion: DiscussionParams;
	builder: BuilderEntryParams;
	verifyUserQuery: VerifyUserQueryParams;
	planner: PlannerParams;
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

// ---------------------------------------------------------------------------
// Shared helpers to eliminate duplication between run / continue
// ---------------------------------------------------------------------------

function createConfiguredWorkflow(
	metadata: WorkflowMetadata,
	modelFactory: ModelFactory,
): Workflow<AIWorkflowRegistry> {
	const workflow = new Workflow<AIWorkflowRegistry>(metadata);

	// Register workflow-level tools
	const workflowTools = createWorkflowTools(metadata);
	for (const [toolName, tool] of Object.entries(workflowTools)) {
		workflow.registerTool(toolName, tool);
	}

	// Register all nodes
	workflow.addNode(new ClassifierNode(modelFactory));
	workflow.addNode(new DiscussionNode(modelFactory));
	workflow.addNode(new BuilderEntryNode(modelFactory));
	workflow.addNode(new VerifyUserQueryNode(modelFactory));
	workflow.addNode(new PlannerNode(modelFactory));

	return workflow;
}

function attachStatusTracking(
	workflow: Workflow<AIWorkflowRegistry>,
	conversationId: string,
	conversationStatus: ConversationWorkflowStatus,
	job: Job<AIWorkflowGatewayData>,
) {
	workflow.onNodeEnter(async (nodeId) => {
		conversationStatus.status = "running";
		conversationStatus.currentNodeId = nodeId;
		conversationStatus.executionHistory.push({
			name: nodeId,
			status: "running",
			type: "node",
		});
		await trackConversationStatus(conversationId, conversationStatus, job);
	});

	workflow.onNodeSuccess(async (nodeId) => {
		conversationStatus.currentNodeId = nodeId;
		conversationStatus.executionHistory.push({
			name: nodeId,
			status: "success",
			type: "node",
		});
		await trackConversationStatus(conversationId, conversationStatus, job);
	});

	workflow.onNodeFailure(async (nodeId) => {
		conversationStatus.executionHistory.push({
			name: nodeId,
			status: "failure",
			type: "node",
		});
		await trackConversationStatus(conversationId, conversationStatus, job);
	});

	workflow.onToolExecution(async (toolName) => {
		conversationStatus.executionHistory.push({
			name: toolName,
			status: "success",
			type: "tool",
		});
		await trackConversationStatus(conversationId, conversationStatus, job);
	});
}

/**
 * Maps a workflow's final result onto the conversation status object.
 * Handles the `under_plan_review` vs `completed` branching in one place.
 */
function applyFinalResult(
	conversationStatus: ConversationWorkflowStatus,
	finalResult: any,
) {
	if (
		finalResult &&
		finalResult.builderState?.workflowStatus === "under_plan_review"
	) {
		conversationStatus.status = "under_plan_review";
		conversationStatus.finalResult = {
			type: "plan_review",
			markdownPlan: finalResult.plannerOutput?.markdownPlan,
			success: finalResult.plannerOutput?.success,
			warnings: finalResult.plannerOutput?.scratchPad?.filter((s: string) =>
				s.includes("WARNING"),
			),
			builderStepData: finalResult,
		};
	} else {
		conversationStatus.status = "success";
		conversationStatus.finalResult = finalResult;
	}
}

/**
 * Shared cleanup logic for both run and continue workflows.
 */
async function finalizeWorkflow(
	conversationId: string,
	conversationStatus: ConversationWorkflowStatus,
	job: Job<AIWorkflowGatewayData>,
	projectId?: string,
) {
	await trackConversationStatus(conversationId, conversationStatus, job, true);
	await saveConversationStatus(conversationStatus);
	activeWorkflows.delete(conversationId);

	if (projectId) {
		await invalidateConversationCaches(conversationId, projectId);
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initializes and schedules an AI Workflow in the background.
 */
export async function runAIWorkflow(params: RunWorkflowParams) {
	const { metadata, initialQuery, modelFactory, model, job } = params;
	const { conversationId } = metadata;

	if (activeWorkflows.has(conversationId)) {
		return { conversationId, status: "already_running" };
	}

	await invalidateConversationCaches(conversationId, metadata.projectId);

	const workflow = createConfiguredWorkflow(metadata, modelFactory);
	const conversationStatus: ConversationWorkflowStatus = {
		status: "started",
		conversationId,
		userQuery: initialQuery,
		currentNodeId: "classifier",
		executionHistory: [],
	};

	await trackConversationStatus(conversationId, conversationStatus, job);
	attachStatusTracking(workflow, conversationId, conversationStatus, job);
	activeWorkflows.set(conversationId, workflow);

	try {
		const finalResult = (await workflow.start("classifier", {
			query: initialQuery,
			messageHistory: metadata.messageHistory,
			model,
		})) as any;

		applyFinalResult(conversationStatus, finalResult);
	} catch (error) {
		logger.error(`[Workflow] Error in conversation: ${conversationId}`, {
			error,
		});
		conversationStatus.status = "error";
		conversationStatus.finalResult = `Error occured while running the agent`;
	} finally {
		await finalizeWorkflow(
			conversationId,
			conversationStatus,
			job,
			metadata.projectId,
		);
	}

	return { conversationId, status: "started" };
}

export async function continueAIWorkflow(
	params: RunWorkflowParams,
	jobData: AIWorkflowGatewayData["data"],
) {
	const { metadata, modelFactory, job, initialQuery } = params;
	const { conversationId } = metadata;

	if (activeWorkflows.has(conversationId)) {
		return { conversationId, status: "already_running" };
	}

	const workflow = createConfiguredWorkflow(metadata, modelFactory);
	const conversationStatus: ConversationWorkflowStatus = {
		status: "running",
		conversationId,
		userQuery: initialQuery,
		currentNodeId: "planner",
		executionHistory: [],
		chatHistoryId: jobData.chatHistoryId,
	};

	await trackConversationStatus(conversationId, conversationStatus, job);
	attachStatusTracking(workflow, conversationId, conversationStatus, job);
	activeWorkflows.set(conversationId, workflow);

	try {
		const step = await fetchLastBuilderStep(conversationId);

		if (!step || step.stepType !== "planner") {
			throw new Error("Cannot continue: No planner state found");
		}

		const builderState = step.inputData as any;

		if (jobData.reviewAction === "modify" && jobData.reviewComments) {
			const comments =
				jobData.reviewComments && typeof jobData.reviewComments === "string"
					? JSON.parse(jobData.reviewComments)
					: [];
			const previousPlan =
				step.outputData?.markdownPlan ||
				builderState.plannerOutput?.markdownPlan ||
				"Previous plan";

			const newMessageHistory: any[] = metadata.messageHistory || [];

			const reviewQuery = `Original Request:
${initialQuery}

You previously proposed this plan:
${previousPlan}

I have reviewed your plan. Please make the following modifications and replan:
${comments.map((c: string) => `- ${c}`).join("\n")}`;

			// Re-run planner
			const finalResult = (await workflow.continue("planner", {
				query: reviewQuery,
				messageHistory: newMessageHistory,
				model: params.model,
				builderState,
				metadata: params.metadata,
			})) as any;

			applyFinalResult(conversationStatus, finalResult);
		} else if (jobData.reviewAction === "approve") {
			// User approved the plan. Since orchestrator isn't built yet, we complete the workflow.
			conversationStatus.status = "success";
			conversationStatus.finalResult = {
				type: "plan_approved",
				message:
					"Plan approved successfully. Next execution steps will follow.",
			};
		}
	} catch (error) {
		logger.error("Workflow error", "workflow", { error });
		conversationStatus.status = "error";
		conversationStatus.finalResult = `Error occured while continuing the agent`;
	} finally {
		await finalizeWorkflow(conversationId, conversationStatus, job);
	}
}

export function initializeAIWorkflow() {
	const workflowWorker = new Worker<AIWorkflowGatewayData>(
		WORKER_QUEUE_NAME,
		async (job) => {
			const { conversationId, userQuery } = job.data.data;

			const conversation = await fetchConversation(conversationId);

			if (!conversation) {
				throw new Error(`Conversation ${conversationId} not found`);
			}

			const projectId = conversation.projectId;
			const userId = conversation.userId;
			const routeId = conversation.metadata.routeId || "none";
			const location = conversation.metadata.location;

			const modelInstance = await createAIModelInstanceFromProjectId(projectId);

			const params: RunWorkflowParams = {
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
			};

			if (job.name === CONTINUE_WORKFLOW_JOB_NAME) {
				await continueAIWorkflow(params, job.data.data);
			} else {
				await runAIWorkflow(params);
			}
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

// Re-export nodes for external use if necessary
export * from "./nodes/classifier";
export * from "./nodes/discussion";
export * from "./nodes/builder/builderEntry";
export * from "./nodes/builder/verifyUserQuery";
export * from "./nodes/builder/plannerNode";

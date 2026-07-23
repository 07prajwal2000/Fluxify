import { Queue, QueueEvents } from "bullmq";
import { REDIS_HOST, REDIS_PASS, REDIS_PORT, REDIS_USER } from "../lib/env";
import { EventEmitter } from "events";

export const WORKER_QUEUE_NAME = "SCHEDULE_AI_WORKFLOW_QUEUE";
export const START_WORKFLOW_JOB_NAME = "START_AI_WORKFLOW_JOB";
export const CONTINUE_WORKFLOW_JOB_NAME = "CONTINUE_AI_WORKFLOW_JOB";

export type AIWorkflowGatewayData = {
	type: "start" | "continue" | "plan_review";
	data: {
		conversationId: string;
		userQuery: string;
		reviewAction?: "approve" | "reject" | "modify";
		reviewComments?: string;
		chatHistoryId?: string;
	};
};

export interface ConversationWorkflowStatus {
	status:
		| "started"
		| "running"
		| "error"
		| "success"
		| "under_plan_review"
		| "plan_rejected";
	conversationId: string;
	userQuery: string;
	currentNodeId: string;
	executionHistory: {
		name: string;
		status: "success" | "failure" | "running";
		type: "tool" | "node";
		input?: any;
		output?: any;
	}[];
	finalResult?: any; // depends on last node's output
	chatHistoryId?: string;
}

export let workflowQueue: Queue<AIWorkflowGatewayData> = null!;
export let workflowQueueEvents: QueueEvents = null!;
export let conversationEventEmitter: EventEmitter = null!; // use this for SSE streams to get updated workflow status to send data to user
let initialized = false;

export function initializeWorkflowQueue() {
	if (initialized) {
		return;
	}
	workflowQueue = new Queue<AIWorkflowGatewayData>(WORKER_QUEUE_NAME, {
		connection: {
			host: REDIS_HOST,
			port: parseInt(REDIS_PORT),
			password: REDIS_PASS,
			username: REDIS_USER,
		},
	});
	workflowQueueEvents = new QueueEvents(WORKER_QUEUE_NAME, {
		connection: {
			host: REDIS_HOST,
			port: parseInt(REDIS_PORT),
			password: REDIS_PASS,
			username: REDIS_USER,
		},
	});
	conversationEventEmitter = new EventEmitter();
	workflowQueueEvents.on("progress", (args) => {
		const updatedData = args.data as ConversationWorkflowStatus;
		const eventId = `${updatedData.conversationId}`;
		conversationEventEmitter.emit(eventId, updatedData);
	});
	initialized = true;
}

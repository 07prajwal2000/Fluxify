import { Queue } from "bullmq";
import { REDIS_HOST, REDIS_PASS, REDIS_PORT, REDIS_USER } from "../lib/env";

export const WORKER_QUEUE_NAME = "SCHEDULE_AI_WORKFLOW_QUEUE";
export const START_WORKFLOW_JOB_NAME = "START_AI_WORKFLOW_JOB";

export type AIWorkflowGatewayData = {
	type: "start";
	data: {
		userQuery: string;
		location: string;
		routeId: string;
		projectId: string;
		userId: string;
	};
};

export const workflowQueue = new Queue<AIWorkflowGatewayData>(
	WORKER_QUEUE_NAME,
	{
		connection: {
			host: REDIS_HOST,
			port: parseInt(REDIS_PORT),
			password: REDIS_PASS,
			username: REDIS_USER,
		},
	},
);

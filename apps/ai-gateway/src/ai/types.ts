import { type ModelMessage, generateText } from "ai";

export interface WorkflowMetadata {
	// combination of userId + projectId + location + routeId
	conversationId: string;
	userId: string;
	projectId: string;
	location: string;
	routeId: string;
	messageHistory: ModelMessage[];
}

export interface WorkflowContext {
	metadata: WorkflowMetadata;
	tools: Record<string, any>; // Now accepts standard Vercel AI tools natively
	trackToolExecution: (toolName: string, input: any, output: any) => void;
}

export interface NodeResult {
	status: "success" | "failure";
	nextNodeId?: string;
}

export interface NodeExecutionRecord {
	nodeId: string;
	timestamp: Date;
	input: any;
	output?: any;
	error?: any;
	status: "success" | "failure";
}

export interface ToolExecutionRecord {
	toolName: string;
	timestamp: Date;
	input: any;
	output: any;
}

export type NodeSuccessCallback = (
	nodeId: string,
	input: any,
	output: any,
) => void | Promise<void>;
export type NodeFailureCallback = (
	nodeId: string,
	input: any,
	error: any,
) => void | Promise<void>;
export type ToolExecutionCallback = (
	toolName: string,
	input: any,
	output: any,
) => void | Promise<void>;

export type GenerateTextFn = typeof generateText;
export type ModelFactory = (config?: any) => Promise<GenerateTextFn>;

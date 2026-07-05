import { watchConversationDto } from "@fluxify/ai-gateway";
import { z } from "zod";

export interface Message {
	id: string;
	status?: string;
	userQuery?: string;
	finalOutput?: {
		nodeId: string;
		result: any;
	};
	workflowExecutionHistory?:
		| {
				type: "node" | "tool";
				id?: string;
				name?: string;
				input?: any;
				status: "running" | "success" | "failure";
				output?: any;
		  }[]
		| null;
	createdAt?: string;
}

export interface ConversationHistoryProps {
	messages?: Message[];
	isLoading: boolean;
	isError: boolean;
	error: any;
	onRetry: () => void;
	workflowStatus?: z.infer<
		typeof watchConversationDto.watchResponseSchema
	> | null;
	fetchNextPage?: () => void;
	hasNextPage?: boolean;
	isFetchingNextPage?: boolean;
}

export type VirtualItemData =
	| { type: "message"; id: string; message: Message }
	| { type: "workflow"; id: string; status: any };

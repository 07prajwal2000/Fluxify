import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { aiGatewayWorkflowsService } from "@/services/aiGatewayWorkflows";
import { aiGatewayConversationsQuery } from "@/query/aiGatewayConversationsQuery";
import { watchConversationDto } from "@fluxify/ai-gateway";
import z from "zod";

export type WorkflowStatus = z.infer<typeof watchConversationDto.watchResponseSchema>;

export const useWorkflowWatcher = (conversationId?: string, watchTrigger: number = 0) => {
	const queryClient = useQueryClient();
	const [isWatching, setIsWatching] = useState(false);
	const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);

	useEffect(() => {
		if (!conversationId) return;

		let cleanup: (() => void) | undefined;
		let isMounted = true;
		let timeoutId: NodeJS.Timeout;
		const maxRetries = 4;
		let currentStatus: WorkflowStatus | null = null;
		let currentRetryCount = maxRetries;
		let connectTime = Date.now();

		const connect = () => {
			if (!isMounted) return;
			setIsWatching(true);
			if (cleanup) cleanup();
            
			connectTime = Date.now();

			cleanup = aiGatewayWorkflowsService.watchConversation(
				conversationId,
				(status) => {
					setWorkflowStatus(status);
					currentStatus = status;
					if (status.status === "completed" || status.status === "error") {
						aiGatewayConversationsQuery.listMessagesInfinite.invalidate(conversationId, queryClient);
					}
				},
				(err) => {
					handleReconnect(err);
				},
				() => {
					if (currentStatus?.status === "completed" || currentStatus?.status === "error") {
						setIsWatching(false);
						setWorkflowStatus(null);
						aiGatewayConversationsQuery.listMessagesInfinite.invalidate(conversationId, queryClient);
					} else {
						handleReconnect(new Error("Connection closed prematurely"));
					}
				},
			);
		};

		const handleReconnect = (err?: any) => {
			if (!isMounted) return;
			if (currentStatus?.status === "completed" || currentStatus?.status === "error") {
				setIsWatching(false);
				setWorkflowStatus(null);
				return;
			}

			// If the connection was open for more than 10 seconds, reset the retry count
			if (Date.now() - connectTime > 10000) {
				currentRetryCount = maxRetries;
			}

			if (currentRetryCount > 0) {
				const baseDelay = currentRetryCount === maxRetries ? 1000 : 1500;
				const backoff = Math.pow(2, maxRetries - currentRetryCount);
				const delay = Math.min(baseDelay * backoff, 10000);

				console.log(
					`Watch connection disconnected. Retrying in ${delay}ms... (${currentRetryCount} left)`,
				);
				currentRetryCount--;
				timeoutId = setTimeout(() => connect(), delay);
			} else {
				console.error("Workflow watch error after retries", err);
				setIsWatching(false);
				setWorkflowStatus(null);
			}
		};

		connect();

		return () => {
			isMounted = false;
			clearTimeout(timeoutId);
			if (cleanup) cleanup();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [conversationId, watchTrigger]);

	return {
		isWatching,
		workflowStatus,
		setWorkflowStatus,
	};
};

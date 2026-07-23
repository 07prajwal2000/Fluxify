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
		let initialTimeoutId: NodeJS.Timeout;
		const maxRetries = 10;
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
					if (status.status === "success" || status.status === "error" || status.status === "plan_rejected") {
						aiGatewayConversationsQuery.listMessagesInfinite.invalidate(conversationId, queryClient);
					}
				},
				(err) => {
					handleReconnect(err);
				},
				() => {
					if (currentStatus?.status === "success" || currentStatus?.status === "error" || currentStatus?.status === "plan_rejected") {
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
			if (currentStatus?.status === "success" || currentStatus?.status === "error" || currentStatus?.status === "plan_rejected") {
				setIsWatching(false);
				setWorkflowStatus(null);
				return;
			}

			// If the connection was open for more than 10 seconds, reset the retry count
			if (Date.now() - connectTime > 10000) {
				currentRetryCount = maxRetries;
			}

			if (currentRetryCount > 0) {
				const baseDelay = 2000;
				const backoff = Math.pow(1.5, maxRetries - currentRetryCount);
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

		// If watchTrigger > 0, wait a few seconds before connecting to let the workflow scheduling happen
		if (watchTrigger > 0) {
			initialTimeoutId = setTimeout(() => connect(), 2500);
		} else {
			connect();
		}

		return () => {
			isMounted = false;
			clearTimeout(timeoutId);
			clearTimeout(initialTimeoutId);
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

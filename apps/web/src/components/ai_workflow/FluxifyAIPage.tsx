"use client";
import React, { useState, useEffect } from "react";
import { Stack, Group, Center, Text, Container, Box } from "@mantine/core";
import { TbSparkles } from "react-icons/tb";
import ConversationHeader from "./ConversationHeader";
import EmptyArtifactPanel from "./EmptyArtifactPanel";
import { AIPromptInput } from "./AIPromptInput";
import { ConversationHistory } from "./ConversationHistory";
import { useRouter } from "next/navigation";
import { APP_ROUTES } from "@/constants/routes";
import { useQueryClient } from "@tanstack/react-query";
import { aiGatewayWorkflowsQuery } from "@/query/aiGatewayWorkflowsQuery";
import { aiGatewayConversationsQuery } from "@/query/aiGatewayConversationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { aiGatewayWorkflowsService } from "@/services/aiGatewayWorkflows";
import { watchConversationDto } from "@fluxify/ai-gateway";
import z from "zod";

interface Props {
	projectId: string;
	conversationId?: string;
}

const FluxifyAIPage = ({ projectId, conversationId }: Props) => {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [message, setMessage] = useState("");
	const [showArtifactPanel, setShowArtifactPanel] = useState(false);
	const [isWatching, setIsWatching] = useState(false);
	const [workflowStatus, setWorkflowStatus] = useState<z.infer<
		typeof watchConversationDto.watchResponseSchema
	> | null>(null);

	// Fetch messages if in an existing conversation using infinite query (perPage: 5)
	const {
		data: messagesData,
		isLoading,
		isError,
		error,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = aiGatewayConversationsQuery.listMessagesInfinite.useInfiniteQuery(
		conversationId || "",
		5,
	);

	// Flatten pages in reverse order so array goes from oldest (index 0) to newest (index N)
	const messages = React.useMemo(() => {
		if (!messagesData?.pages) return [];
		return messagesData.pages
			.slice()
			.reverse()
			.flatMap((page) => page?.messages || []);
	}, [messagesData]);

	const conversationTitle = messagesData?.pages?.[0]?.conversation?.title;

	const postMessageMutation =
		aiGatewayWorkflowsQuery.postMessage.useMutation(queryClient);

	const createConversationMutation =
		aiGatewayConversationsQuery.create.useMutation(queryClient);

	useEffect(() => {
		if (isError && error) {
			const status = (error as any)?.response?.status || (error as any)?.status;
			if (status === 404) {
				showErrorNotification(new Error("Conversation not found"));
				router.push(APP_ROUTES.PROJECT_AI(projectId));
			}
		}
	}, [isError, error, router, projectId]);

	const [watchTrigger, setWatchTrigger] = useState(0);

	useEffect(() => {
		if (!conversationId) return;

		let cleanup: (() => void) | undefined;
		let isMounted = true;
		let timeoutId: NodeJS.Timeout;
		const maxRetries = 4;

		const connect = (retryCount: number) => {
			if (!isMounted) return;
			setIsWatching(true);
			if (cleanup) cleanup();

			cleanup = aiGatewayWorkflowsService.watchConversation(
				conversationId,
				(status) => {
					setWorkflowStatus(status);
					if (status.status === "completed" || status.status === "error") {
						aiGatewayConversationsQuery.listMessagesInfinite.invalidate(conversationId, queryClient);
					}
				},
				(err) => {
					if (retryCount > 0) {
						const baseDelay = retryCount === maxRetries ? 1000 : 1500;
						const backoff = Math.pow(2, 3 - retryCount);
						const delay = Math.min(baseDelay * backoff, 10000);

						console.log(
							`Watch connection failed. Retrying in ${delay}ms... (${retryCount} left)`,
						);
						timeoutId = setTimeout(() => connect(retryCount - 1), delay);
					} else {
						console.error("Workflow watch error after retries", err);
						setIsWatching(false);
					}
				},
				() => {
					setIsWatching(false);
					setWorkflowStatus(null);
					aiGatewayConversationsQuery.listMessagesInfinite.invalidate(conversationId, queryClient);
				},
			);
		};

		connect(maxRetries); // Start connection with 3 retries

		return () => {
			isMounted = false;
			clearTimeout(timeoutId);
			if (cleanup) cleanup();
		};
	}, [conversationId, watchTrigger]); // Removed queryClient to prevent unnecessary reconnections

	const handleSelectConversation = (id: string) => {
		router.push(APP_ROUTES.PROJECT_AI_CONVERSATION(projectId, id));
	};

	const handleNewConversation = () => {
		router.push(APP_ROUTES.PROJECT_AI(projectId));
	};

	const handleSend = () => {
		if (!message.trim()) return;

		const userQuery = message;
		setMessage("");

		if (!conversationId) {
			createConversationMutation.mutate(
				{
					query: { location: "ai_window" },
					body: {
						projectId,
						startWorkflow: true,
						initialUserQuery: userQuery,
					},
				},
				{
					onSuccess: (data) => {
						if (data && data.id) {
							router.push(
								APP_ROUTES.PROJECT_AI_CONVERSATION(projectId, data.id),
							);
						}
					},
					onError: () => {
						setMessage(userQuery); // Restore message on error
						showErrorNotification(new Error("Failed to start conversation"));
					},
				},
			);
		} else {
			// Encapsulated Optimistic update
			aiGatewayConversationsQuery.listMessagesInfinite.appendOptimisticMessage(
				queryClient,
				conversationId,
				userQuery,
				5,
			);

			// Immediately set workflowStatus to show "thinking" UI
			setWorkflowStatus({
				status: "started",
				conversationId,
				userQuery,
				currentNodeId: "classifier",
				executionHistory: [],
			});

			setWatchTrigger((prev) => prev + 1); // Trigger watch connection immediately
			postMessageMutation.mutate(
				{
					param: { conversationId },
					body: { userQuery },
				},
				{
					onSuccess: () => {
						// Removed from here to prevent missing early SSE events
					},
					onError: () => {
						setMessage(userQuery); // Restore message on error
						setWorkflowStatus(null); // Clear optimistic workflow state
						showErrorNotification(new Error("Failed to send message"));
						// Optionally rollback optimistic update here by invalidating
						queryClient.invalidateQueries({
							queryKey: ["ai-conversations", "listMessagesInfinite", conversationId],
						});
					},
				},
			);
		}
	};

	const isConversationEmpty =
		!conversationId ||
		(!isLoading && !isError && messages.length === 0);

	const showFancyUI = isConversationEmpty && !workflowStatus;

	const isActionLoading =
		postMessageMutation.isPending ||
		createConversationMutation.isPending ||
		createConversationMutation.isSuccess;

	return (
		<Group h="100%" gap={0} wrap="nowrap" align="stretch">
			{/* Main Chat Area */}
			<Stack
				flex={1}
				h="100%"
				p="md"
				gap="md"
				style={{ minWidth: 0, minHeight: 0 }}
			>
				<ConversationHeader
					projectId={projectId}
					activeConversationId={conversationId || null}
					activeConversationName={
						conversationId
							? conversationTitle || "Loading..."
							: "New Conversation"
					}
					onSelectConversation={handleSelectConversation}
					onNewConversation={handleNewConversation}
				/>

				{showFancyUI ? (
					<Center flex={1} style={{ flexDirection: "column" }} px="md">
						<Stack align="center" gap="xl" w="100%" maw={700}>
							<Stack align="center" gap="md" mb="md">
								<Group gap="xs" align="center">
									<TbSparkles size={32} color="#7950f2" />
									<Text
										size="42px"
										fw={800}
										variant="gradient"
										gradient={{ from: "violet", to: "grape", deg: 45 }}
										style={{
											letterSpacing: "-1px",
											lineHeight: 1.3,
											paddingBottom: "4px",
										}}
									>
										Fluxify AI
									</Text>
								</Group>
								<Text size="lg" c="dimmed" ta="center" maw={500}>
									Your intelligent assistant to design and build backend APIs.
									Describe what you need, and let the AI do the heavy lifting.
								</Text>
							</Stack>
						</Stack>
					</Center>
				) : (
					<ConversationHistory
						messages={messages}
						isLoading={isLoading}
						isError={isError}
						error={error}
						onRetry={refetch}
						workflowStatus={workflowStatus}
						fetchNextPage={fetchNextPage}
						hasNextPage={hasNextPage}
						isFetchingNextPage={isFetchingNextPage}
					/>
				)}

				<Container size="md" w="100%" p={0}>
					<AIPromptInput
						value={message}
						onChange={setMessage}
						onSend={handleSend}
						isLoading={isActionLoading}
						showSidebarToggle={!!conversationId && !showArtifactPanel}
						onToggleSidebar={() => setShowArtifactPanel(true)}
						staticPlaceholder={
							conversationId ? "Message Fluxify..." : undefined
						}
						minRows={2}
					/>
				</Container>
			</Stack>

			{/* Artifact Panel */}
			{showArtifactPanel && (
				<EmptyArtifactPanel onClose={() => setShowArtifactPanel(false)} />
			)}
		</Group>
	);
};

export default FluxifyAIPage;

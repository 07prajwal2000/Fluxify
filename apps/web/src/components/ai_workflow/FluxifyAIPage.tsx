"use client";
import React, { useState, useEffect } from "react";
import { Stack, Group, Container } from "@mantine/core";
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
import { useWorkflowWatcher } from "./useWorkflowWatcher";
import { FluxifyAIWelcome } from "./FluxifyAIWelcome";

interface Props {
	projectId: string;
	conversationId?: string;
}

const FluxifyAIPage = ({ projectId, conversationId }: Props) => {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [message, setMessage] = useState("");
	const [showArtifactPanel, setShowArtifactPanel] = useState(false);

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

	const { workflowStatus, setWorkflowStatus } = useWorkflowWatcher(
		conversationId,
		watchTrigger,
	);

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
					<FluxifyAIWelcome />
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

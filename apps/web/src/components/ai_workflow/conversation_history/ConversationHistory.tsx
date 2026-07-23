import React, { useMemo } from "react";
import {
	Stack,
	Group,
	Text,
	Center,
	Button,
	Box,
	ActionIcon,
	Loader,
	Transition,
	Skeleton,
} from "@mantine/core";
import { TbRefresh, TbArrowDown } from "react-icons/tb";
import { ConversationHistoryProps, VirtualItemData } from "./types";
import { useVirtualChatScroll } from "./useVirtualChatScroll";
import { MessageItemRow } from "./MessageItemRow";
import { WorkflowStatusRow } from "./WorkflowStatusRow";

export const ConversationHistory = ({
	conversationId,
	messages,
	isLoading,
	isError,
	error,
	onRetry,
	workflowStatus,
	fetchNextPage,
	hasNextPage,
	isFetchingNextPage,
}: ConversationHistoryProps) => {
	const items: VirtualItemData[] = useMemo(() => {
		const result: VirtualItemData[] = [];
		if (messages) {
			messages.forEach((msg) => {
				result.push({ type: "message", id: msg.id, message: msg });
			});
		}
		if (
			workflowStatus &&
			workflowStatus.status !== "success" &&
			workflowStatus.status !== "error"
		) {
			result.push({
				type: "workflow",
				id: `workflow-${workflowStatus.conversationId || "active"}`,
				status: workflowStatus,
			});
		}
		return result;
	}, [messages, workflowStatus]);

	const {
		parentRef,
		rowVirtualizer,
		showScrollBottomButton,
		handleScroll,
		scrollToBottom,
	} = useVirtualChatScroll({
		items,
		hasNextPage,
		isFetchingNextPage,
		fetchNextPage,
	});

	return (
		<Box flex={1} style={{ position: "relative", minHeight: 0, width: "100%" }}>
			<Box
				ref={parentRef}
				onScroll={handleScroll}
				style={{
					height: "100%",
					overflowY: "auto",
					overflowX: "hidden",
					padding: "16px",
				}}
			>
				<Stack w="100%" maw="1050px" mx="auto" gap="md" style={{ minHeight: "100%" }}>
					{/* Loading indicator when fetching older messages */}
					{isFetchingNextPage && (
						<Center py="xs">
							<Group gap="xs">
								<Loader size="sm" color="violet" />
								<Text size="xs" c="dimmed">
									Loading older messages...
								</Text>
							</Group>
						</Center>
					)}

					{/* Loading state */}
					{isLoading && items.length === 0 && (
						<Stack gap="md" py="xl">
							<Skeleton height={60} radius="md" width="70%" style={{ alignSelf: "flex-end" }} />
							<Skeleton height={120} radius="md" width="80%" style={{ alignSelf: "flex-start" }} />
						</Stack>
					)}

					{/* Error state */}
					{isError &&
						(error?.response?.status >= 500 || error?.status >= 500) && (
							<Center h="100%" style={{ flexDirection: "column", gap: "10px" }} py="xl">
								<Text c="red">
									Failed to load conversation:{" "}
									{error?.message || "Internal Server Error"}
								</Text>
								<Button
									leftSection={<TbRefresh size={16} />}
									variant="light"
									color="red"
									onClick={onRetry}
								>
									Retry
								</Button>
							</Center>
						)}

					{/* Virtualized Messages Container */}
					{!isLoading && !isError && items.length > 0 && (
						<Box
							style={{
								height: `${rowVirtualizer.getTotalSize()}px`,
								width: "100%",
								position: "relative",
							}}
						>
							{rowVirtualizer.getVirtualItems().map((virtualRow) => {
								const item = items[virtualRow.index];
								return (
									<Box
										key={virtualRow.key}
										data-index={virtualRow.index}
										ref={rowVirtualizer.measureElement}
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											width: "100%",
											transform: `translateY(${virtualRow.start}px)`,
											paddingBottom: "16px",
										}}
									>
										{item.type === "message" ? (
											<MessageItemRow message={item.message} conversationId={conversationId} />
										) : (
											<WorkflowStatusRow status={item.status} messages={messages} />
										)}
									</Box>
								);
							})}
						</Box>
					)}
				</Stack>
			</Box>

			{/* Floating Scroll to Bottom Button */}
			<Transition
				mounted={showScrollBottomButton}
				transition="slide-up"
				duration={200}
				timingFunction="ease"
			>
				{(style) => (
					<ActionIcon
						style={{
							...style,
							position: "absolute",
							bottom: 24,
							right: 24,
							zIndex: 10,
							boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
						}}
						variant="filled"
						color="violet"
						size="lg"
						radius="xl"
						onClick={scrollToBottom}
						aria-label="Scroll to bottom"
					>
						<TbArrowDown size={20} />
					</ActionIcon>
				)}
			</Transition>
		</Box>
	);
};

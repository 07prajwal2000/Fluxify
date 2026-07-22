import React, { useState, useEffect } from "react";
import {
	Modal,
	Grid,
	Box,
	Stack,
	Text,
	Button,
	Group,
	ActionIcon,
	Popover,
	Textarea,
	Title,
	List,
	Paper,
	Divider,
	Table,
	Blockquote,
	Code,
	Anchor,
	ScrollArea,
	Card,
} from "@mantine/core";
import { TbMessageCirclePlus, TbCheck, TbX, TbEdit } from "react-icons/tb";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQueryClient } from "@tanstack/react-query";
import { aiGatewayConversationsQuery } from "@/query/aiGatewayConversationsQuery";

interface PlanReviewModalProps {
	opened: boolean;
	onClose: () => void;
	plan: string;
	chatId?: string;
	conversationId?: string;
	isReadOnly?: boolean;
}

// Custom wrapper to enable line/block-level reviewing
const HoverableBlock = ({
	children,
	blockId,
	existingReview,
	onSaveReview,
	isSelected,
	onClick,
}: {
	children: React.ReactNode;
	blockId: string;
	existingReview?: string;
	onSaveReview: (id: string, text: string) => void;
	isSelected?: boolean;
	onClick?: () => void;
}) => {
	const [hovered, setHovered] = useState(false);
	const [popoverOpened, setPopoverOpened] = useState(false);
	const [reviewText, setReviewText] = useState(existingReview || "");

	const handleSave = () => {
		onSaveReview(blockId, reviewText);
		setPopoverOpened(false);
	};

	const hasReview = !!existingReview;

	return (
		<Box
			id={blockId}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				position: "relative",
				padding: "4px 8px",
				margin: "8px 0",
				borderRadius: "8px",
				backgroundColor: isSelected ? "var(--mantine-color-violet-light)" : hasReview ? "var(--mantine-color-violet-light)" : hovered ? "var(--mantine-color-default-hover)" : "transparent",
				borderLeft: isSelected ? "4px solid var(--mantine-color-violet-filled)" : hasReview ? "4px solid var(--mantine-color-violet-filled)" : "4px solid transparent",
				transition: "all 0.2s ease",
				boxShadow: isSelected ? "0 0 0 1px var(--mantine-color-violet-filled)" : "none",
			}}
		>
			{children}

			{(hovered || popoverOpened || hasReview) && (
				<Box style={{ position: "absolute", top: "4px", right: "8px", zIndex: 10 }}>
					<Popover
						opened={popoverOpened}
						onChange={setPopoverOpened}
						position="left-start"
						withArrow
						shadow="md"
						trapFocus
					>
						<Popover.Target>
							<ActionIcon
								variant={hasReview ? "light" : "subtle"}
								color={hasReview ? "violet" : "gray"}
								onClick={() => setPopoverOpened((o) => !o)}
								size="sm"
							>
								{hasReview ? <TbEdit size={14} /> : <TbMessageCirclePlus size={14} />}
							</ActionIcon>
						</Popover.Target>
						<Popover.Dropdown>
							<Stack gap="xs" style={{ width: "250px" }}>
								<Text size="sm" fw={500}>
									{hasReview ? "Edit Review" : "Add Review"}
								</Text>
								<Textarea
									placeholder="What needs to be changed?"
									value={reviewText}
									onChange={(e) => setReviewText(e.currentTarget.value)}
									minRows={2}
									data-autofocus
								/>
								<Group justify="flex-end" gap="xs">
									<Button variant="subtle" size="xs" color="gray" onClick={() => setPopoverOpened(false)}>
										Cancel
									</Button>
									<Button size="xs" color="violet" onClick={handleSave}>
										Save
									</Button>
								</Group>
							</Stack>
						</Popover.Dropdown>
					</Popover>
				</Box>
			)}
		</Box>
	);
};

export const PlanReviewModal = ({ opened, onClose, plan, chatId, conversationId, isReadOnly }: PlanReviewModalProps) => {
	const [reviews, setReviews] = useState<Record<string, string>>({});
	const [rejectPopoverOpened, setRejectPopoverOpened] = useState(false);
	const [rejectReason, setRejectReason] = useState("");
	const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

	const queryClient = useQueryClient();
	const recordActionMutation = aiGatewayConversationsQuery.recordAction.useMutation(conversationId || "", queryClient);

	useEffect(() => {
		if (selectedBlockId) {
			const timeout = setTimeout(() => {
				setSelectedBlockId(null);
			}, 5000);
			return () => clearTimeout(timeout);
		}
	}, [selectedBlockId]);

	const handleReviewClick = (id: string) => {
		setSelectedBlockId(id);
		const element = document.getElementById(id);
		if (element) {
			element.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	};

	const handleSaveReview = (id: string, text: string) => {
		setReviews((prev) => {
			const newReviews = { ...prev };
			if (!text.trim()) {
				delete newReviews[id];
			} else {
				newReviews[id] = text;
			}
			return newReviews;
		});
	};

	const hasReviews = Object.keys(reviews).length > 0;

	const handleAction = (action: "approve" | "reject" | "review") => {
		console.log("handleAction called", { action, chatId, conversationId, hasMutation: !!recordActionMutation });
		if (!chatId || !conversationId || !recordActionMutation) {
			console.error("Early return from handleAction", { chatId, conversationId, hasMutation: !!recordActionMutation });
			return;
		}

		const payload: any = { chatId, action };
		if (action === "reject") payload.rejectReason = rejectReason || undefined;
		if (action === "review") payload.reviews = Object.values(reviews);

		recordActionMutation.mutate(payload, {
			onSuccess: () => {
				onClose();
				// If review or approve, we could do something optimistic if needed
			},
			onError: (err) => {
				console.error("Failed to record action:", err);
				alert(`Action failed: ${err.message || String(err)}`);
			}
		});
	};

	// Split the markdown into roughly block-level chunks based on double newlines
	// This makes it easier to assign stable block IDs for reviews
	const blocks = plan.split(/\n\n+/).filter((b) => b.trim().length > 0);

	return (
		<Modal
			opened={opened}
			onClose={onClose}
			title={<Title order={3} style={{ fontFamily: "Hanken Grotesk, sans-serif" }}>Review Proposed Plan</Title>}
			size="1400px"
			radius="lg"
			transitionProps={{ transition: "fade", duration: 200 }}
			styles={{
				header: { padding: "24px 32px", borderBottom: "1px solid var(--mantine-color-default-border)" },
				body: { padding: "16px", backgroundColor: "var(--mantine-color-gray-0)" }
			}}
		>
			<Box style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden", height: "70vh", gap: "16px" }}>
				{/* Left Panel: Markdown Content (66%) */}
				<Paper radius="md" bg="white" shadow="sm" style={{ flex: 2, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
					<ScrollArea h="100%" p="xl" offsetScrollbars>
						<Box maw="800px" mx="auto">
							{blocks.map((blockContent, index) => {
								const blockId = "block-" + index;
								return (
									<HoverableBlock
										key={blockId}
										blockId={blockId}
										existingReview={reviews[blockId]}
										onSaveReview={handleSaveReview}
										isSelected={selectedBlockId === blockId}
										onClick={() => setSelectedBlockId(blockId)}
									>
										<ReactMarkdown
											remarkPlugins={[remarkGfm]}
											components={{
												p: ({ node, ...props }: any) => <Text mb="sm" size="sm" style={{ lineHeight: 1.6 }} {...props} />,
												h1: ({ node, ...props }: any) => <Title order={2} mt="xl" mb="md" fw={600} {...props} />,
												h2: ({ node, ...props }: any) => <Title order={3} mt="lg" mb="sm" fw={600} {...props} />,
												h3: ({ node, ...props }: any) => <Title order={4} mt="md" mb="sm" fw={500} {...props} />,
												h4: ({ node, ...props }: any) => <Title order={5} mt="md" mb="xs" fw={500} {...props} />,
												ul: ({ node, ...props }: any) => <List type="unordered" mb="sm" size="sm" {...props} />,
												ol: ({ node, ...props }: any) => <List type="ordered" mb="sm" size="sm" {...props} />,
												li: ({ node, ...props }: any) => <List.Item {...props} />,
												a: ({ node, ...props }: any) => <Anchor {...props} />,
												table: ({ node, ...props }: any) => (
													<Paper withBorder radius="md" my="md" style={{ overflowX: "auto" }}>
														<Table striped highlightOnHover withTableBorder={false} withColumnBorders={false} {...props} />
													</Paper>
												),
												pre: ({ node, ...props }: any) => (
													<Paper withBorder p="sm" my="md" bg="dark.7" radius="md" style={{ overflowX: "auto" }}>
														<Box component="pre" m={0} c="gray.0" fz="sm" style={{ fontFamily: "monospace" }} {...props} />
													</Paper>
												),
												code: ({ node, className, children, ...props }: any) => {
													const isBlock = /language-(\w+)/.test(className || "") || String(children).includes("\n");
													if (isBlock) {
														return <code className={className} {...props}>{children}</code>;
													}
													return <Code {...props}>{children}</Code>;
												},
												blockquote: ({ node, ...props }: any) => <Blockquote my="md" p="md" color="violet" radius="sm" fz="sm" {...props} />,
												hr: ({ node, ...props }: any) => <Divider my="xl" {...props} />,
												strong: ({ node, ...props }: any) => <Text component="strong" fw={600} {...props} />,
												b: ({ node, ...props }: any) => <Text component="b" fw={600} {...props} />,
											}}
										>
											{blockContent}
										</ReactMarkdown>
									</HoverableBlock>
								);
							})}
						</Box>
					</ScrollArea>
				</Paper>

				{/* Right Panel: Reviews (33%) */}
				<Paper radius="md" bg="white" shadow="sm" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
					<Box p="xl" pb="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
						<Text fw={600} size="lg" m={0}>
							Your Reviews
						</Text>
					</Box>
					<Box p="xl" style={{ flex: 1, overflowY: "auto" }}>
						{hasReviews ? (
							<Stack gap="sm">
								{Object.entries(reviews).map(([id, text]) => (
									<Card
										key={id}
										withBorder
										radius="md"
										p="md"
										onClick={() => handleReviewClick(id)}
										style={{
											cursor: "pointer",
											borderColor: selectedBlockId === id ? "var(--mantine-color-violet-filled)" : undefined,
											backgroundColor: selectedBlockId === id ? "var(--mantine-color-violet-light)" : "white",
											transition: "all 0.2s ease"
										}}
									>
										<Group justify="space-between" align="flex-start" wrap="nowrap">
											<Text size="sm" style={{ flex: 1, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
												{text}
											</Text>
											<ActionIcon
												variant="subtle"
												color="red"
												onClick={(e) => {
													e.stopPropagation();
													handleSaveReview(id, "");
												}}
												size="sm"
											>
												<TbX size={14} />
											</ActionIcon>
										</Group>
									</Card>
								))}
							</Stack>
						) : (
							<Text size="sm" c="dimmed" ta="center" mt="xl">
								Hover over any line on the left to add a review.
							</Text>
						)}
					</Box>

					{/* Right Panel Footer */}
					{!isReadOnly && (
						<Box p="md" px="xl" style={{ borderTop: "1px solid var(--mantine-color-default-border)", backgroundColor: "var(--mantine-color-body)" }}>
							<Group justify="flex-end" wrap="nowrap">
								<Popover opened={rejectPopoverOpened} onChange={setRejectPopoverOpened} position="top-end" withArrow shadow="md" trapFocus>
									<Popover.Target>
										<Button variant="default" leftSection={<TbX size={16} />} onClick={() => setRejectPopoverOpened((o) => !o)} loading={recordActionMutation?.isPending}>
											Reject
										</Button>
									</Popover.Target>
									<Popover.Dropdown>
										<Stack gap="xs" style={{ width: "250px" }}>
											<Text size="sm" fw={500}>
												Rejection Reason (Optional)
											</Text>
											<Textarea
												placeholder="Why are you rejecting this plan?"
												value={rejectReason}
												onChange={(e) => setRejectReason(e.currentTarget.value)}
												minRows={2}
												data-autofocus
											/>
											<Group justify="flex-end" gap="xs">
												<Button variant="subtle" size="xs" color="gray" onClick={() => setRejectPopoverOpened(false)}>
													Cancel
												</Button>
												<Button size="xs" color="red" onClick={() => {
													setRejectPopoverOpened(false);
													handleAction("reject");
												}}>
													Confirm Reject
												</Button>
											</Group>
										</Stack>
									</Popover.Dropdown>
								</Popover>
								<Button
									color="violet"
									variant={hasReviews ? "light" : "filled"}
									leftSection={hasReviews ? <TbEdit size={16} /> : <TbCheck size={16} />}
									onClick={() => handleAction(hasReviews ? "review" : "approve")}
									loading={recordActionMutation?.isPending}
								>
									{hasReviews ? "Review Plan" : "Approve"}
								</Button>
							</Group>
						</Box>
					)}
				</Paper>
			</Box>
		</Modal>
	);
};

import React, { useState } from "react";
import {
	Stack,
	Group,
	Text,
	Button,
	Paper,
	ThemeIcon,
	Box,
} from "@mantine/core";
import { TbClipboardList, TbX, TbAlertTriangle } from "react-icons/tb";
import { PlanReviewModal } from "./PlanReviewModal";
import { WorkflowExecutionHistory } from "./WorkflowExecutionHistory";

interface PlannerNodeDisplayProps {
	result: {
		type: string;
		markdownPlan: string;
		success: boolean;
		rejectReason?: string;
		warnings?: string[];
		builderStepData?: any;
		rejected?: boolean;
		approved?: boolean;
		reviewed?: boolean;
	};
	executionHistory: any[];
	chatId: string;
	conversationId: string;
	status?: string;
}

export const PlannerNodeDisplay = ({
	result,
	chatId,
	conversationId,
	status,
	executionHistory,
}: PlannerNodeDisplayProps) => {
	const [isModalOpen, setIsModalOpen] = useState(false);
	const isRejected = result.rejected || status === "plan_rejected";
	const isApproved = result.approved;
	const isReviewed = result.reviewed;
	const isFailed = result.success === false;

	return (
		<Stack gap="xs" w="100%">
			{executionHistory && executionHistory.length > 0 && (
				<Box
					p="md"
					bg="gray.0"
					style={{ borderRadius: "8px", border: "1px solid #e9ecef" }}
				>
					<WorkflowExecutionHistory
						history={executionHistory}
						defaultExpanded={false}
					/>
				</Box>
			)}
			
			{!isApproved && !isReviewed && (
				<Paper
					withBorder
					radius="md"
					p="md"
					bg={isFailed ? "red.0" : "violet.0"}
					style={{ borderColor: isFailed ? "var(--mantine-color-red-2)" : "var(--mantine-color-violet-2)" }}
				>
					<Stack gap="xs">
						<Group gap="sm">
							<ThemeIcon
								size="md"
								radius="xl"
								color={isFailed || isRejected ? "red" : "violet"}
								variant="light"
							>
								{isFailed ? <TbAlertTriangle size={16} /> : isRejected ? <TbX size={16} /> : <TbClipboardList size={16} />}
							</ThemeIcon>
							<Text fw={600} size="sm" c={isFailed || isRejected ? "red.7" : "violet.9"}>
								{isFailed ? "Plan Generation Failed" : isRejected ? "Plan Rejected" : "Proposed Plan Ready"}
							</Text>
						</Group>

						<Text size="sm" c={isFailed ? "red.6" : "dimmed"}>
							{isFailed
								? result.rejectReason || "The AI could not generate a plan for your request. Please modify your request and try again."
								: isRejected
								? "The AI's proposed plan was rejected. You can view the rejected plan for reference."
								: "The AI has analyzed your request and created an implementation plan. Please review and approve the plan before we proceed with building the flow."}
						</Text>

						<Group mt="sm">
							<Button
								variant="filled"
								color={isFailed || isRejected ? "red" : "violet"}
								onClick={() => setIsModalOpen(true)}
								disabled={isFailed && !result.markdownPlan}
							>
								{isFailed ? "View failure details" : isRejected ? "See rejected plan" : "View & Review Plan"}
							</Button>
						</Group>
					</Stack>
				</Paper>
			)}

			<PlanReviewModal
				opened={isModalOpen}
				onClose={() => setIsModalOpen(false)}
				plan={result.markdownPlan || result.rejectReason || "No plan generated."}
				chatId={chatId}
				conversationId={conversationId}
				isReadOnly={isFailed || isRejected || isApproved || isReviewed}
			/>
		</Stack>
	);
};

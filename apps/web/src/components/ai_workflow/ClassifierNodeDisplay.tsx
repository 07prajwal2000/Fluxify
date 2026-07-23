import React from "react";
import { Stack, Text, Code, Alert, Group } from "@mantine/core";
import {
	WorkflowExecutionHistory,
	WorkflowExecutionHistoryProps,
} from "./WorkflowExecutionHistory";
import type { ClassifierResult } from "@fluxify/ai-gateway";
import { TbAlertCircle, TbRoute } from "react-icons/tb";

export interface ClassifierNodeDisplayProps {
	result: ClassifierResult;
	executionHistory: NonNullable<WorkflowExecutionHistoryProps["history"]>;
}

export const ClassifierNodeDisplay = ({
	result,
	executionHistory,
}: ClassifierNodeDisplayProps) => {
	const isFailure = result.status === "failure";

	return (
		<Stack
			gap="xs"
			p="md"
			bg="gray.0"
			style={{ borderRadius: "8px", border: "1px solid #e9ecef" }}
		>
			<WorkflowExecutionHistory
				history={executionHistory}
				defaultExpanded={false}
			/>

			{isFailure ? (
				<Alert
					variant="light"
					color="red"
					title="Classification Failed"
					icon={<TbAlertCircle size={16} />}
					styles={{ title: { fontWeight: 600 } }}
				>
					{result.reasoning ||
						"The classifier was unable to determine the appropriate route for this query."}
				</Alert>
			) : (
				<Stack gap="xs">
					<Group gap="xs" align="center">
						<TbRoute size={18} color="#9c36b5" />
						<Text fw={600} size="sm" c="grape.7">
							Routed to:{" "}
							{result.route
								? result.route.charAt(0).toUpperCase() + result.route.slice(1)
								: "Unknown"}
						</Text>
					</Group>

					{result.reasoning && (
						<Text size="sm" c="dimmed">
							{result.reasoning ||
								"Could not complete the workflow execution. Please try again with necessary information, so AI can understand and understand the requirement of workflow."}
						</Text>
					)}
				</Stack>
			)}
		</Stack>
	);
};

import React from "react";
import { ClassifierNodeDisplay } from "./ClassifierNodeDisplay";
import { DiscussionNodeDisplay } from "./DiscussionNodeDisplay";
import { PlannerNodeDisplay } from "./PlannerNodeDisplay";
import { Stack, Text, Code } from "@mantine/core";
import { WorkflowExecutionHistory } from "./WorkflowExecutionHistory";

interface NodeResultDisplayProps {
	nodeId: string;
	result: any;
	executionHistory: any[];
	chatId: string;
	conversationId: string;
	status?: string;
}

export const NodeResultDisplay = ({ nodeId, result, executionHistory, chatId, conversationId, status }: NodeResultDisplayProps) => {
	switch (nodeId) {
		case "classifier":
			return <ClassifierNodeDisplay result={result} executionHistory={executionHistory} />;
		case "discussion":
			return <DiscussionNodeDisplay result={result} executionHistory={executionHistory} />;
		case "planner":
			return <PlannerNodeDisplay result={result} executionHistory={executionHistory} chatId={chatId} conversationId={conversationId} status={status} />;
		default:
			// Fallback display
			return (
				<Stack gap="xs" p="md" bg="gray.0" style={{ borderRadius: "8px", border: "1px solid #e9ecef" }}>
					<WorkflowExecutionHistory history={executionHistory} defaultExpanded={false} />
					<Text fw={600} size="sm" c="gray.7">
						Unknown Node Result ({nodeId})
					</Text>
					<Code block bg="white" style={{ maxHeight: "200px", overflowY: "auto", maxWidth: "100%" }}>
						{JSON.stringify(result, null, 2)}
					</Code>
				</Stack>
			);
	}
};

import React from "react";
import { Stack, Group, Card } from "@mantine/core";
import { WorkflowExecutionHistory } from "../WorkflowExecutionHistory";
import { UserQueryBubble } from "./UserQueryBubble";
import { Message } from "./types";

export interface WorkflowStatusRowProps {
	status: any;
	messages?: Message[];
}

export const WorkflowStatusRow = React.memo(
	({ status, messages }: WorkflowStatusRowProps) => {
		// Suppress duplicate user query bubble if already displayed in messages list (e.g. via optimistic update)
		const isQueryAlreadyInMessages = Boolean(
			status?.userQuery &&
				messages?.some((msg) => msg.userQuery === status.userQuery),
		);

		return (
			<Stack gap="md" w="100%">
				{status.userQuery && !isQueryAlreadyInMessages && (
					<UserQueryBubble userQuery={status.userQuery} />
				)}
				<Group justify="flex-start" w="100%" align="flex-start">
					<Card
						shadow="sm"
						padding="md"
						radius="md"
						withBorder
						w="100%"
						maw="80%"
					>
						<WorkflowExecutionHistory
							history={status.executionHistory}
							isRunning={true}
							defaultExpanded={true}
						/>
					</Card>
				</Group>
			</Stack>
		);
	},
);

WorkflowStatusRow.displayName = "WorkflowStatusRow";

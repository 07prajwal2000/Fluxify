import React from "react";
import { Stack, Group, Box } from "@mantine/core";
import { NodeResultDisplay } from "../NodeResultDisplay";
import { UserQueryBubble } from "./UserQueryBubble";
import { Message } from "./types";

export interface MessageItemRowProps {
	message: Message;
	conversationId: string;
}

export const MessageItemRow = React.memo(({ message, conversationId }: MessageItemRowProps) => (
	<Stack gap="md" w="100%">
		{message.userQuery && <UserQueryBubble userQuery={message.userQuery} />}
		{message.finalOutput && message.finalOutput.nodeId && (
			<Group justify="flex-start" w="100%" align="flex-start">
				<Box style={{ maxWidth: "80%", width: "100%" }}>
					<NodeResultDisplay
						nodeId={message.finalOutput.nodeId}
						result={message.finalOutput.result}
						executionHistory={message.workflowExecutionHistory || []}
						chatId={message.id}
						conversationId={conversationId}
						status={message.status}
					/>
				</Box>
			</Group>
		)}
	</Stack>
));

MessageItemRow.displayName = "MessageItemRow";

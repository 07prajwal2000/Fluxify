import React from "react";
import { Group, Stack, Text } from "@mantine/core";

export interface UserQueryBubbleProps {
	userQuery: string;
}

export const UserQueryBubble = React.memo(({ userQuery }: UserQueryBubbleProps) => (
	<Group justify="flex-end" w="100%" align="flex-start">
		<Stack
			gap="xs"
			p="md"
			bg="violet.1"
			align="flex-end"
			style={{
				borderRadius: "8px",
				maxWidth: "80%",
				minWidth: "15%",
			}}
		>
			<Text size="sm">{userQuery}</Text>
		</Stack>
	</Group>
));

UserQueryBubble.displayName = "UserQueryBubble";

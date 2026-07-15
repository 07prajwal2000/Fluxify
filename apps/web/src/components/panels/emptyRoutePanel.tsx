import { Stack, Text } from "@mantine/core";
import React from "react";

const EmptyRoutePanel = ({ projectId }: { projectId?: string }) => {
	return (
		<Stack
			bg="gray.1"
			bd={"2px solid gray.4"}
			bdrs={"sm"}
			justify="center"
			align="center"
			w={"100%"}
			h={"30vh"}
		>
			<Text size="xl" fw={500}>
				No Routes Found
			</Text>
			{projectId && (
				<>
					<Text c="gray.7" size="md" fw={500}>
						Create a new <b>Route</b> to Get Started
					</Text>
				</>
			)}
		</Stack>
	);
};

export default EmptyRoutePanel;

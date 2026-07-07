import { Button, Stack, Text } from "@mantine/core";
import React from "react";
import FormDialog from "../dialog/formDialog";
import { useDisclosure } from "@mantine/hooks";

const EmptyRoutePanel = ({ projectId }: { projectId?: string }) => {
	const [opened, { open, close }] = useDisclosure(false);
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
						Create a new route to get started
					</Text>
					<Button color="dark" variant="outline" onClick={open}>
						Add New Route
					</Button>
				</>
			)}
		</Stack>
	);
};

export default EmptyRoutePanel;

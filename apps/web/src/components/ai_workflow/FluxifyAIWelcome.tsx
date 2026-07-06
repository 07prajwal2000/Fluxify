import React from "react";
import { Center, Stack, Group, Text } from "@mantine/core";
import { TbSparkles } from "react-icons/tb";

export const FluxifyAIWelcome = () => {
	return (
		<Center flex={1} style={{ flexDirection: "column" }} px="md">
			<Stack align="center" gap="xl" w="100%" maw={700}>
				<Stack align="center" gap="md" mb="md">
					<Group gap="xs" align="center">
						<TbSparkles size={32} color="#7950f2" />
						<Text
							size="42px"
							fw={800}
							variant="gradient"
							gradient={{ from: "violet", to: "grape", deg: 45 }}
							style={{
								letterSpacing: "-1px",
								lineHeight: 1.3,
								paddingBottom: "4px",
							}}
						>
							Fluxify AI
						</Text>
					</Group>
					<Text size="lg" c="dimmed" ta="center" maw={500}>
						Your intelligent assistant to design and build backend APIs.
						Describe what you need, and let the AI do the heavy lifting.
					</Text>
				</Stack>
			</Stack>
		</Center>
	);
};

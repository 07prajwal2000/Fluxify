import React, { useState, useEffect } from "react";
import {
	Box,
	Collapse,
	Group,
	Text,
	UnstyledButton,
	ThemeIcon,
	Stack,
} from "@mantine/core";
import { TbChevronDown, TbChevronRight, TbTool, TbNote } from "react-icons/tb";

export interface WorkflowExecutionHistoryProps {
	history?: any[] | null;
	isRunning?: boolean;
	defaultExpanded?: boolean;
}

export const WorkflowExecutionHistory = ({
	history,
	isRunning = false,
	defaultExpanded = false,
}: WorkflowExecutionHistoryProps) => {
	const [opened, setOpened] = useState(defaultExpanded);

	// Automatically close when running finishes
	useEffect(() => {
		if (!isRunning && defaultExpanded) {
			setOpened(false);
		}
	}, [isRunning, defaultExpanded]);

	// Animated dots for "Running ..."
	const [dots, setDots] = useState("");
	useEffect(() => {
		if (!isRunning) return;
		const interval = setInterval(() => {
			setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
		}, 500);
		return () => clearInterval(interval);
	}, [isRunning]);

	const getText = (item: any) => {
		const labelId = item.id || item.name;
		if (item.type === "tool") {
			return `Tool call: ${labelId}`;
		} else {
			if (item.status === "running") return `Running: ${labelId}`;
			if (item.status === "success") return `Completed: ${labelId}`;
			return `Failed: ${labelId}`;
		}
	};

	const processedHistory = React.useMemo(() => {
		if (!history) return [];
		const result: any[] = [];
		const nodeIndexMap = new Map<string, number>();

		history.forEach((item) => {
			if (item.type === "node") {
				const key = item.id || item.name;
				if (nodeIndexMap.has(key)) {
					result[nodeIndexMap.get(key)!] = item;
				} else {
					nodeIndexMap.set(key, result.length);
					result.push(item);
				}
			} else {
				result.push(item);
			}
		});
		return result;
	}, [history]);

	if (!history || history.length === 0) {
		if (isRunning) {
			return (
				<Text size="sm" c="dimmed" mt="xs" ml="xs">
					Running {dots}
				</Text>
			);
		}
		return null;
	}

	return (
		<Box>
			<UnstyledButton onClick={() => setOpened((o) => !o)} py="xs">
				<Group gap="xs">
					{opened ? (
						<TbChevronDown size={14} color="dimmed" />
					) : (
						<TbChevronRight size={14} color="dimmed" />
					)}
					<Text size="sm" fw={500} c="dimmed">
						Show/Hide Thinking Process
					</Text>
				</Group>
			</UnstyledButton>

			<Collapse in={opened}>
				<Box
					pl="md"
					pt="xs"
					style={{
						borderLeft: "1px dashed #ced4da",
						marginLeft: "6px",
						marginBottom: "8px",
					}}
				>
					<Stack gap="sm">
						{processedHistory.map((item, idx) => {
							const isSuccess = item.status === "success";
							const isFailure = item.status === "failure";
							const color = isSuccess ? "green" : isFailure ? "red" : "yellow";
							const Icon = item.type === "tool" ? TbTool : TbNote;

							return (
								<Group key={idx} gap="sm" wrap="nowrap" align="flex-start">
									<ThemeIcon
										color={color}
										size={20}
										radius="xl"
										variant="light"
										mt={2}
									>
										<Icon size={12} />
									</ThemeIcon>
									<Stack gap={4}>
										<Text size="sm" c={isFailure ? "red" : "dimmed"} style={{ wordBreak: "break-all" }}>
											{getText(item)}
										</Text>
										{item.output?.reasoning && (
											<Text size="xs" c="dimmed" fs="italic">
												Thinking: {item.output.reasoning}
											</Text>
										)}
										{item.output?.rejectReason && (
											<Text size="xs" c="red" fw={500}>
												Error: {item.output.rejectReason}
											</Text>
										)}
									</Stack>
								</Group>
							);
						})}
					</Stack>
				</Box>
			</Collapse>

			{isRunning && (
				<Text size="sm" c="dimmed" mt="xs" ml="xs">
					Running {dots}
				</Text>
			)}
		</Box>
	);
};

"use client";

import React from "react";
import { customBlocksQueries } from "@/query/customBlocksQuery";
import { Loader, Alert, Text, Center, Group } from "@mantine/core";
import { TbAlertCircle } from "react-icons/tb";
import CustomBlockCard from "./CustomBlockCard";

interface CustomBlocksListProps {
	projectId: string;
	searchQuery: string;
}

export default function CustomBlocksList({ projectId, searchQuery }: CustomBlocksListProps) {
	const { data, isLoading, error } = customBlocksQueries.getAll.useQuery({
		projectId,
	});

	if (isLoading) {
		return (
			<Center p="xl">
				<Loader type="dots" />
			</Center>
		);
	}

	if (error) {
		return (
			<Alert icon={<TbAlertCircle size={16} />} title="Error" color="red">
				Failed to load custom blocks.
			</Alert>
		);
	}

	if (!data || data.length === 0) {
		return <Text c="dimmed">No custom blocks found.</Text>;
	}

	const filteredData = data.filter((block) => {
		const query = searchQuery.toLowerCase();
		const titleMatch = block.label?.toLowerCase().includes(query);
		const nameMatch = block.name?.toLowerCase().includes(query);
		return titleMatch || nameMatch;
	});

	if (filteredData.length === 0) {
		return <Text c="dimmed">No custom blocks match your search.</Text>;
	}

	return (
		<Group wrap="wrap" gap={32} mt="xl">
			{filteredData.map((block) => (
				<CustomBlockCard key={block.id} block={block} projectId={projectId} />
			))}
		</Group>
	);
}

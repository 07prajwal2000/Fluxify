"use client";

import { useEffect, useCallback } from "react";
import { Stack, Group, Box, Text, Center } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import DebouncedTextInput from "@/components/editors/debouncedTextInput";
import AppConfigTable from "@/components/tables/appConfigTable";
import Pagination from "@/components/pagination/Pagination";
import { useAppConfig } from "@/context/appConfigPage";
import { appConfigQuery } from "@/query/appConfigQuery";
import AppConfigDeleteButton from "../buttons/appConfigTableDeleteButton";
import AppConfigTableAddButton from "../buttons/appConfigTableAddButton";
import RequireRoleInAnyProject from "../auth/requireRoleInAnyProject";

const AppConfigList = () => {
	const queryClient = useQueryClient();
	const { projectId } = useParams<{ projectId: string }>();
	const {
		page,
		setPage,
		perPage,
		setPerPage,
		search,
		setSearch,
		sortBy,
		sort,
		totalPages,
		setTotalPages,
		selectedItems,
	} = useAppConfig();

	// Fetch app configs
	const { data, isLoading, error } = appConfigQuery.getAll.useQuery(
		projectId as string,
		{
			page,
			perPage,
			search,
			sortBy: sortBy as
				| "id"
				| "keyName"
				| "createdAt"
				| "updatedAt"
				| "isEncrypted"
				| "encodingType"
				| undefined,
			sort,
		},
	);

	// Update total pages when data changes
	useEffect(() => {
		if (data?.pagination?.totalPages) {
			setTotalPages(data.pagination.totalPages);
		}
	}, [data?.pagination?.totalPages, setTotalPages]);

	const handleDelete = useCallback(async () => {
		if (selectedItems.size === 0) return;
		try {
			queryClient.invalidateQueries({
				queryKey: ["app-config", projectId, "list"],
			});
		} catch (error) {
			console.error("Error deleting items:", error);
		}
	}, [selectedItems, queryClient, projectId]);

	if (error) {
		return (
			<Center py={60}>
				<Stack align="center" gap="md">
					<Text c="red" fw={600} style={{ fontFamily: "Inter, sans-serif" }}>Error loading configurations</Text>
					<Text c="dimmed" size="sm" style={{ fontFamily: "Inter, sans-serif" }}>
						{error instanceof Error ? error.message : "Unknown error"}
					</Text>
				</Stack>
			</Center>
		);
	}

	return (
		<Stack gap="xl" h="100%" p="md">
			{/* Toolbar */}
			<Group justify="space-between" align="center" p="xs">
				<Box style={{ flex: 1, maxWidth: "400px" }}>
					<DebouncedTextInput
						placeholder="Search configurations..."
						value={search}
						onValueChange={setSearch}
						debounceDelay={300}
						size="md"
						radius="md"
					/>
				</Box>
				<Group gap="md">
					{!isLoading && data && (
						<Pagination
							page={page}
							perPage={perPage}
							totalPages={totalPages}
							onPageChange={setPage}
							onPerPageChange={setPerPage}
						/>
					)}
					<RequireRoleInAnyProject requiredRole="project_admin">
						<AppConfigDeleteButton />
					</RequireRoleInAnyProject>
					<AppConfigTableAddButton />
				</Group>
			</Group>
			
			<Box
				style={{
					flex: 1,
					height: "100%",
					overflow: "hidden",
					backgroundColor: "#ffffff",
					borderRadius: "16px",
					boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)",
					border: "1px solid rgba(0, 0, 0, 0.04)",
				}}
			>
				<AppConfigTable
					data={data?.data || []}
					isLoading={isLoading}
					onDelete={handleDelete}
				/>
			</Box>
		</Stack>
	);
};

export default AppConfigList;

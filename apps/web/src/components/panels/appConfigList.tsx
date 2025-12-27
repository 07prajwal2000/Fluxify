"use client";

import React, { useEffect, useCallback } from "react";
import {
  Stack,
  Group,
  Button,
  Box,
  Text,
  Center,
  Loader,
  ActionIcon,
} from "@mantine/core";
import { TbTrash, TbPlus } from "react-icons/tb";
import { useQueryClient } from "@tanstack/react-query";
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
  const { data, isLoading, error } = appConfigQuery.getAll.useQuery({
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
  });

  // Update total pages when data changes
  useEffect(() => {
    if (data?.pagination?.totalPages) {
      setTotalPages(data.pagination.totalPages);
    }
  }, [data?.pagination?.totalPages, setTotalPages]);

  const handleDelete = useCallback(async () => {
    if (selectedItems.size === 0) return;

    const selectedIds = Array.from(selectedItems);
    console.log("Deleting items:", selectedIds);

    // Partial implementation - getting all selected IDs and handling loading states
    try {
      // TODO: Implement actual delete mutation
      // for (const id of selectedIds) {
      //   await appConfigService.delete(id);
      // }
      // Invalidate queries after deletion
      queryClient.invalidateQueries({
        queryKey: ["app-config", "list"],
      });
    } catch (error) {
      console.error("Error deleting items:", error);
    }
  }, [selectedItems, queryClient]);

  if (error) {
    return (
      <Center py={40}>
        <Stack align="center" gap="md">
          <Text c="red">Error loading configurations</Text>
          <Text c="dimmed" size="sm">
            {error instanceof Error ? error.message : "Unknown error"}
          </Text>
        </Stack>
      </Center>
    );
  }

  return (
    <Stack gap="md" h="100%">
      {/* Toolbar */}
      <Group justify="space-between" align="flex-end">
        <Group grow>
          <DebouncedTextInput
            placeholder="Search configurations..."
            value={search}
            onValueChange={setSearch}
            debounceDelay={300}
          />
        </Group>
        <Group gap="xs">
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
          border: "1px solid #e0e0e0",
          borderRadius: "4px",
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

"use client";

import { Box, Divider, Group, Stack, Text } from "@mantine/core";
import React from "react";
import AddProjectMemberButton from "./addProjectMemberButton";
import ProjectMember from "./projectMember";
import { projectMembersQuery } from "@/query/projectMembersQuery";
import { useParams } from "next/navigation";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import FilterMembersButton from "./filterMembersButton";
import {
  useProjectSettingsActions,
  useProjectSettingsMembersStore,
} from "@/store/projectSettings";
import Pagination from "../pagination/Pagination";

const ProjectMembersList = () => {
  const { projectId } = useParams();
  const { filter, pagination } = useProjectSettingsMembersStore();
  const { setMembersPagination } = useProjectSettingsActions();
  const { data, isLoading, isRefetching, isError, error } =
    projectMembersQuery.list.useQuery(projectId?.toString() || "", {
      ...pagination,
      name: filter.name,
      role: filter.role as any,
    });
  if ((isError || !data) && !(isLoading || isRefetching)) {
    return <QueryError error={error!} />;
  }
  return (
    <Stack>
      <Group justify="space-between" pt={"xs"} px={"xs"}>
        <Text size="lg" fw={"500"} c="dark">
          Project Members List
        </Text>
        <Group>
          <Pagination
            onPageChange={(page) => setMembersPagination(pagination.page, page)}
            onPerPageChange={(perPage) =>
              setMembersPagination(perPage, pagination.page)
            }
            page={pagination.page}
            perPage={pagination.perPage}
            totalPages={data?.pagination.totalPages || 0}
          />
          <AddProjectMemberButton projectId={projectId?.toString() || ""} />
          <FilterMembersButton />
        </Group>
      </Group>
      <Divider />
      {isLoading || isRefetching ? (
        <Box h={"30vh"}>
          <QueryLoader type="spinner" />
        </Box>
      ) : (
        <Stack>
          {data!.data.map((member) => (
            <ProjectMember data={member} key={member.id} />
          ))}
          {data!.data.length === 0 && (
            <Text size="lg" ta={"center"}>
              No members found
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
};

export default ProjectMembersList;

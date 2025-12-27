import { ActionIcon, Button, Group, Stack, Text } from "@mantine/core";
import React, { useState } from "react";
import MenuItem from "./menuItem";
import { TbCirclePlus, TbStack2 } from "react-icons/tb";
import { projectsQuery } from "@/query/projectsQuery";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import FormDialog from "../dialog/formDialog";
import ProjectForm from "../forms/projectForm";
import { projectsService } from "@/services/projects";
import z from "zod";
import { showErrorNotification } from "@/lib/errorNotifier";
import { useDisclosure } from "@mantine/hooks";
import RequireRoleInAnyProject from "../auth/requireRoleInAnyProject";

const ProjectList = () => {
  const { useQuery, invalidate } = projectsQuery.getAll;
  const client = useQueryClient();
  const path = usePathname().substring(1);
  const nav = useRouter();
  const [open, { open: openDialog, close: closeDialog }] = useDisclosure(false);
  const queryParams = {
    page: 1,
    perPage: 50,
  };
  const { data, isLoading, isError, isRefetching } = useQuery(queryParams);
  if (isLoading || isRefetching) {
    return <QueryLoader skeletonsRows={3} skeletonsCols={1} />;
  }
  if (isError) {
    return (
      <QueryError
        fontSize="xs"
        overrideMessage="Error loading projects"
        refetcher={() => invalidate(queryParams, client)}
      />
    );
  }
  function onProjectItemClicked(projectId: string) {
    nav.push(`/${projectId}`);
  }

  return (
    <Stack pb={"md"} mah={"100%"} gap={"xs"} style={{ overflowY: "auto" }}>
      <Group
        bg={"white"}
        pb={2}
        style={{ position: "sticky", top: 0, zIndex: 10 }}
        justify="space-between"
        align="center"
      >
        <Text px={"sm"} c={"gray"}>
          Projects
        </Text>
        <RequireRoleInAnyProject requiredRole="system_admin">
          <ActionIcon color="violet" variant="light" onClick={openDialog}>
            <TbCirclePlus size={20} />
          </ActionIcon>
        </RequireRoleInAnyProject>
      </Group>
      <Stack gap={4}>
        {(data?.data?.length ?? 0) === 0 && <EmptyProjectInfo />}
        {data?.data?.map((project) => (
          <MenuItem
            key={project.id}
            onClick={() => onProjectItemClicked(project.id)}
            leftIcon={<TbStack2 size={20} />}
            isActive={path === project.id}
            text={project.name!}
            color="dark"
          />
        ))}
      </Stack>
      <NewProjectFormDialog open={open} onClose={closeDialog} />
    </Stack>
  );
};

function EmptyProjectInfo() {
  const [open, { open: openDialog, close: closeDialog }] = useDisclosure(false);
  return (
    <Stack p={"md"} bdrs={"sm"} bd={"1px solid gray"}>
      <Text ta={"center"} size="sm" c={"gray"}>
        No projects here
      </Text>
      <Button
        leftSection={<TbCirclePlus size={20} />}
        color="violet"
        onClick={openDialog}
      >
        Add Project
      </Button>
      <NewProjectFormDialog open={open} onClose={closeDialog} />
    </Stack>
  );
}

function NewProjectFormDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const { invalidateAll } = projectsQuery;
  const client = useQueryClient();
  async function onSubmit(
    values: z.infer<typeof projectsService.createRequestBodySchema>
  ) {
    try {
      setSaving(true);
      await projectsService.create(values);
      onClose();
      invalidateAll(client);
    } catch (error: any) {
      showErrorNotification(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog title="Create New Project" open={open} onClose={onClose}>
      <ProjectForm
        zodSchema={projectsService.createRequestBodySchema}
        onSubmit={onSubmit}
        actionSection={
          <Group mt={"xs"} gap={"xs"} justify="end">
            <Button
              loading={saving}
              type="submit"
              variant="outline"
              color="violet"
            >
              Create
            </Button>
            <Button onClick={onClose} variant="subtle" color="dark">
              Cancel
            </Button>
          </Group>
        }
      />
    </FormDialog>
  );
}

export default ProjectList;

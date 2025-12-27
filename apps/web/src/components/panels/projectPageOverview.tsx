"use client";

import { Group, Stack, Text } from "@mantine/core";
import React from "react";
import CreateNewMenu from "../createNewMenu";
import RequireRole from "../auth/requireRole";

const ProjectPageOverview = ({ projectId }: { projectId: string }) => {
  return (
    <Group justify="space-between" align="center">
      <Stack gap={2}>
        <Text size={"2rem"}>Project Overview</Text>
        <Text c={"gray"} size={".5rem"}>
          Access to all routes, execution history, and project settings
        </Text>
      </Stack>
      <RequireRole projectId={projectId} requiredRole="creator">
        <CreateNewMenu />
      </RequireRole>
    </Group>
  );
};

export default ProjectPageOverview;

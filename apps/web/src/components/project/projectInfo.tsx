"use client";

import { Stack, Group, Divider, Text } from "@mantine/core";
import React from "react";

const ProjectInfo = () => {
  return (
    <Stack>
      <Group justify="space-between">
        <Text size="lg" fw={"500"} c="dark">
          Project Info
        </Text>
        <Group></Group>
      </Group>
      <Divider />
    </Stack>
  );
};

export default ProjectInfo;

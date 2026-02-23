"use client";

import { projectSettingsQuery } from "@/query/projectSettingsQuery";
import { Stack, Group, Divider, Text } from "@mantine/core";
import { useParams } from "next/navigation";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { useQueryClient } from "@tanstack/react-query";
import IntegrationSelector from "../editors/integrationSelector";

const ProjectInfo = () => {
  const { projectId } = useParams();
  const client = useQueryClient();
  const projId = projectId!.toString();
  const { data, isLoading, isError, error } =
    projectSettingsQuery.getAll.useQuery(projId);
  const upsertMutation = projectSettingsQuery.upsert.useMutation(
    projId,
    client,
  );
  if (isLoading) return <QueryLoader skeletonsCols={2} skeletonsRows={4} />;
  if (isError || !data)
    return (
      <QueryError
        overrideMessage="Failed to load project info"
        refetcher={() => projectSettingsQuery.getAll.invalidate(projId, client)}
        error={error || undefined}
      />
    );
  return (
    <Stack>
      <Group justify="space-between">
        <Text size="lg" fw={"500"} c="dark">
          Project Info
        </Text>
      </Group>
      <Divider />
      <Stack>
        <IntegrationSelector
          selectedIntegration={data["settings.ai.agentConnectionId"] || ""}
          group="ai"
          label="LLM Provider for AI Agent"
          description="Choose the LLM provider for AI Agent which is used across the project"
          onSelect={(value) => {
            console.log(value);

            upsertMutation.mutate({
              key: "settings.ai.agentConnectionId",
              value,
            });
          }}
        />
      </Stack>
    </Stack>
  );
};

export default ProjectInfo;

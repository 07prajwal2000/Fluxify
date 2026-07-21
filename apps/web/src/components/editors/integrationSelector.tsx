import { RxOpenInNewWindow } from "react-icons/rx";
import { useDisclosure } from "@mantine/hooks";
import React, { useEffect, useMemo } from "react";
import z from "zod";
import {
  integrationsGroupSchema,
  databaseTagsSchema,
  aiTagsSchema,
  observabilityTagsSchema,
} from "@fluxify/server/src/api/v1/integrations/schemas";
import { integrationsQuery } from "@/query/integrationsQuery";
import { routesQueries } from "@/query/routerQuery";
import { APP_ROUTES } from "@/constants/routes";
import {
  ActionIcon,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import QueryLoader from "../query/queryLoader";
import { integrationIcons, IntegrationVariants } from "../integrationIcons";
import QueryError from "../query/queryError";
import { useQueryClient } from "@tanstack/react-query";
import { TbPlugConnected, TbX } from "react-icons/tb";
import KeySelector from "./keySelector";
import { notifications } from "@mantine/notifications";
import { showErrorNotification } from "@/lib/errorNotifier";
import Link from "next/link";
import { useParams } from "next/navigation";

type IntegrationTags =
  | z.infer<typeof databaseTagsSchema>
  | z.infer<typeof aiTagsSchema>
  | z.infer<typeof observabilityTagsSchema>;

type Props = {
  group: z.infer<typeof integrationsGroupSchema>;
  selectedIntegration: string;
  selectBtnLabel?: string;
  onSelect?: (id: string) => void;
  label?: string | React.ReactNode;
  description?: string;
  tags?: IntegrationTags[];
};

const IntegrationSelector = (props: Props) => {
  const { projectId: paramsProjectId, id: routeId } = useParams<{ projectId?: string; id?: string }>();
  const { data: routeData } = routesQueries.getById.useQuery(routeId || "");
  const activeProjectId = paramsProjectId || routeData?.projectId || "";

  const memoizedTags = useMemo(() => props.tags, [JSON.stringify(props.tags)]);
  const [opened, { open, close }] = useDisclosure();

  const { data, isLoading, isRefetching, isError, error } =
    integrationsQuery.getAll.query(activeProjectId, props.group, memoizedTags);
  const client = useQueryClient();
  const selectedIntegration = useMemo(() => {
    return data?.filter((x) => x.id === props.selectedIntegration)[0];
  }, [data, props.selectedIntegration]);
  const {
    isPending,
    isSuccess,
    mutateAsync,
    isError: isTestConnectionError,
    reset,
  } = integrationsQuery.testExistingConnection.mutation(activeProjectId);

  useEffect(() => {
    if (!isPending && selectedIntegration) {
      reset();
    }
  }, [selectedIntegration]);

  if (isLoading) {
    return <QueryLoader skeletonsCols={1} skeletonsRows={1} />;
  }

  async function refetchIntegrations() {
    await integrationsQuery.getAll.invalidate(activeProjectId, props.group, client, props.tags);
  }

  if (isError) {
    return (
      <QueryError
        error={error}
        overrideMessage="Failed to load queries"
        refetcher={refetchIntegrations}
      />
    );
  }

  async function onTestIntegration(id: string) {
    try {
      await mutateAsync(id);
      notifications.show({
        title: "Success",
        message: "Connection successful",
        color: "green",
      });
    } catch (error: any) {
      showErrorNotification(error);
    }
  }
  function onIntegrationSelect(id: string) {
    props.onSelect?.(id);
  }
  let testButtonColor = "dark";
  if (isSuccess && !isPending) testButtonColor = "green";
  else if (isTestConnectionError && !isPending) testButtonColor = "red";

  return (
    <Stack gap={"xs"}>
      <Stack gap={2}>
        {typeof props.label === "string" ? (
          <Text fw={"500"} size="sm">
            {props.label}
          </Text>
        ) : (
          props.label
        )}
        <Text c={"gray"} size="xs">
          {props.description ?? "Description"}
        </Text>
      </Stack>
      <Paper w={"100%"} p={"4"} withBorder shadow="xs">
        <Group justify="space-between">
          <Group align="center" px={"xs"}>
            {selectedIntegration &&
              integrationIcons[
                selectedIntegration.variant as IntegrationVariants
              ]}
            <Text>
              {selectedIntegration ? selectedIntegration.name : "None Selected"}
            </Text>
          </Group>
          <Group>
            {selectedIntegration && (
              <Tooltip label="Test Connection">
                <ActionIcon
                  loading={isPending}
                  onClick={() => onTestIntegration(selectedIntegration.id)}
                  color={testButtonColor}
                  variant="subtle"
                >
                  <TbPlugConnected />
                </ActionIcon>
              </Tooltip>
            )}
            {selectedIntegration && (
              <Tooltip label="Show Integration Settings">
                <Link
                  target="_blank"
                  href={`${APP_ROUTES.PROJECT_INTEGRATIONS(activeProjectId)}?open=${selectedIntegration.id}&group=${props.group}`}
                >
                  <ActionIcon variant="subtle" color="violet">
                    <RxOpenInNewWindow />
                  </ActionIcon>
                </Link>
              </Tooltip>
            )}
            {selectedIntegration && (
              <Tooltip label="Clear Integration">
                <ActionIcon
                  onClick={() => onIntegrationSelect("")}
                  variant="subtle"
                  color="dark"
                >
                  <TbX />
                </ActionIcon>
              </Tooltip>
            )}
            <Button onClick={open} color="violet">
              {props.selectBtnLabel ?? "Choose"}
            </Button>
            <KeySelector
              opened={opened}
              data={data!}
              selectorKey="id"
              emptyNode={
                <Text ta={"center"} c="gray.8" size="lg" mt={"sm"}>
                  No integrations found
                </Text>
              }
              header={[
                {
                  label: "Name",
                  name: "name",
                },
                {
                  label: "Variant",
                  name: "variant",
                },
              ]}
              closeOnSelect
              onClose={close}
              title="Choose Integration"
              onSelect={onIntegrationSelect}
            />
          </Group>
        </Group>
      </Paper>
    </Stack>
  );
};

export default IntegrationSelector;

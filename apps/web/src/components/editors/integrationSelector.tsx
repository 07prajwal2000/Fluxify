import { RxOpenInNewWindow } from "react-icons/rx";
import { useDisclosure } from "@mantine/hooks";
import React, { useMemo } from "react";
import z from "zod";
import { integrationsGroupSchema } from "@fluxify/server/src/api/v1/integrations/schemas";
import { integrationsQuery } from "@/query/integrationsQuery";
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
import { useRouter } from "next/navigation";
import Link from "next/link";

type Props = {
  group: z.infer<typeof integrationsGroupSchema>;
  selectedIntegration: string;
  selectBtnLabel?: string;
  onSelect?: (id: string) => void;
  label?: string;
  description?: string;
};

const IntegrationSelector = (props: Props) => {
  const router = useRouter();
  const [opened, { open, close }] = useDisclosure();
  const { data, isLoading, isRefetching, isError, error } =
    integrationsQuery.getAll.query(props.group);
  const client = useQueryClient();
  const selectedIntegration = useMemo(() => {
    return data?.filter((x) => x.id === props.selectedIntegration)[0];
  }, [data, props.selectedIntegration]);
  const {
    isPending,
    isSuccess,
    mutateAsync,
    isError: isTestConnectionError,
  } = integrationsQuery.testExistingConnection.mutation();

  if (isLoading || isRefetching) {
    return <QueryLoader skeletonsCols={1} skeletonsRows={1} />;
  }

  async function refetchIntegrations() {
    await integrationsQuery.getAll.invalidate(props.group, client);
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
  if (isSuccess) testButtonColor = "green";
  else if (isTestConnectionError) testButtonColor = "red";

  return (
    <Stack gap={"xs"}>
      <Stack gap={2}>
        <Text fw={"500"} size="sm">
          {props.label ?? "Label"}
        </Text>
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
                  href={`/integrations?open=${selectedIntegration.id}&group=${props.group}`}
                >
                  <ActionIcon variant="subtle" color="violet">
                    <RxOpenInNewWindow />
                  </ActionIcon>
                </Link>
              </Tooltip>
            )}
            {selectedIntegration && (
              <ActionIcon
                onClick={() => onIntegrationSelect("")}
                variant="subtle"
                color="dark"
              >
                <TbX />
              </ActionIcon>
            )}
            <Button onClick={open} color="violet">
              {props.selectBtnLabel ?? "Choose"}
            </Button>
            <KeySelector
              opened={opened}
              data={data!}
              selectorKey="id"
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

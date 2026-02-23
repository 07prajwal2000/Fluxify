"use client";

import { integrationsQuery } from "@/query/integrationsQuery";
import {
  useIntegrationActions,
  useIntegrationState,
} from "@/store/integration";
import React, { useEffect, useMemo } from "react";
import QueryLoader from "../query/queryLoader";
import { Accordion, Center, Group, Stack, Text } from "@mantine/core";
import IntegrationForm from "../forms/integration";
import { integrationIcons, IntegrationVariants } from "../integrationIcons";
import QueryError from "../query/queryError";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { showErrorNotification } from "@/lib/errorNotifier";
import { useRouter, useSearchParams } from "next/navigation";

const IntegrationsList = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const openedIntegration = searchParams.get("open");
  const group = searchParams.get("group");
  const { selectedMenu, filterVariant, searchQuery } = useIntegrationState();
  const { setFilterVariant, setSearchQuery } = useIntegrationActions();
  const { data, isLoading, isError, error } =
    integrationsQuery.getAll.query(selectedMenu);
  const client = useQueryClient();
  const { mutateAsync: updateMutation, isPending } =
    integrationsQuery.update.mutation(client);
  const { mutateAsync: deleteMutation, isPending: isDeletePending } =
    integrationsQuery.delete.mutation(client);

  const filteredData = useMemo(() => {
    if (!data) return [];
    if (filterVariant)
      return data.filter(
        (integration) => integration.variant === filterVariant,
      );
    if (searchQuery)
      return data.filter((integration) =>
        integration.name.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    return data;
  }, [data, filterVariant, searchQuery]);

  useEffect(() => {
    setFilterVariant("");
    setSearchQuery("");
  }, [selectedMenu]);

  if (isLoading) {
    return <QueryLoader type="spinner" spinnerSize="md" />;
  }
  if (isError) {
    return (
      <QueryError
        error={error}
        refetcher={() => {
          integrationsQuery.getAll.invalidate(selectedMenu, client);
        }}
      />
    );
  }

  async function onSubmit(id: string, data: any) {
    const name = data.name as string;
    const config = data.config;
    try {
      await updateMutation({
        id,
        data: {
          name,
          config,
        },
      });
      notifications.show({
        title: "Integration updated",
        message: (
          <Text c={"dark"} size="sm">
            Integration <b>{name}</b> has been updated.
          </Text>
        ),
        color: "green",
      });
    } catch (error: any) {
      showErrorNotification(error, false);
    }
  }
  async function onDelete(id: string) {
    try {
      await deleteMutation(id);
      notifications.show({
        title: "Integration deleted",
        message: `Integration has been deleted.`,
        color: "green",
      });
    } catch (error: any) {
      showErrorNotification(error, false);
    }
  }

  return (
    <Stack flex={1}>
      {filteredData.length === 0 && (
        <Center
          style={{ flexDirection: "column", gap: "1rem" }}
          p={"xl"}
          bg={"gray.1"}
        >
          <Text ta={"center"} size="lg" fw={500}>
            No integrations found.
          </Text>
          {filterVariant || searchQuery ? (
            <Text>No results found</Text>
          ) : (
            <Text>Try adding one now by clicking Connect App/Service</Text>
          )}
        </Center>
      )}
      <Accordion
        defaultValue={openedIntegration}
        onChange={(value) =>
          router.push(`?open=${value || ""}&group=${group || ""}`)
        }
      >
        {filteredData.map((integration) => (
          <Accordion.Item value={integration.id} key={integration.id}>
            <Accordion.Control>
              <Group>
                {integrationIcons[integration.variant as IntegrationVariants]}
                <Text size="md" fw={500}>
                  {integration.name}
                </Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <IntegrationForm
                showDeleteButton
                onDelete={() => onDelete(integration.id)}
                onSubmit={(data) => onSubmit(integration.id, data)}
                saveButtonLabel="Update"
                disableButtons={["group", "variant"]}
                showTestConnection
                showSaveButton
                isLoading={isPending}
                data={integration}
                deleteButtonProps={{ loading: isDeletePending }}
              />
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
};

export default IntegrationsList;

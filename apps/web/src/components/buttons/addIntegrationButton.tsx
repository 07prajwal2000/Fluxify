"use client";
import { Button } from "@mantine/core";
import React from "react";
import { TbPlugConnected } from "react-icons/tb";
import FormDialog from "../dialog/formDialog";
import { useDisclosure } from "@mantine/hooks";
import IntegrationForm from "../forms/integration";
import { integrationsQuery } from "@/query/integrationsQuery";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { showErrorNotification } from "@/lib/errorNotifier";

const AddIntegrationButton = () => {
  const [opened, { close, open }] = useDisclosure();
  const client = useQueryClient();
  const { mutateAsync, isPending } = integrationsQuery.create.mutation(client);

  async function onSubmit(values: any) {
    try {
      await mutateAsync(values);
      close();
    } catch (e) {
      if (isAxiosError(e)) {
        showErrorNotification(e, true);
      }
    }
  }

  return (
    <>
      <Button
        onClick={open}
        color="violet"
        leftSection={<TbPlugConnected size={15} />}
      >
        Connect App/Service
      </Button>
      <FormDialog
        open={opened}
        onClose={close}
        title="Connect a new App/Service"
      >
        <IntegrationForm
          isLoading={isPending}
          showTestConnection
          showSaveButton
          onSubmit={onSubmit}
        />
      </FormDialog>
    </>
  );
};

export default AddIntegrationButton;

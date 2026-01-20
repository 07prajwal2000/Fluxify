import React from "react";
import { Button, Group } from "@mantine/core";
import { TbPlus } from "react-icons/tb";
import { useDisclosure } from "@mantine/hooks";
import FormDialog from "../dialog/formDialog";
import AppConfigForm from "../forms/appConfig";
import { appConfigService } from "@/services/appConfig";
import { showErrorNotification } from "@/lib/errorNotifier";
import { useQueryClient } from "@tanstack/react-query";
import { appConfigQuery } from "@/query/appConfigQuery";

const AppConfigTableAddButton = () => {
  const [opened, { open, close }] = useDisclosure(false);
  const queryClient = useQueryClient();
  const { mutateAsync, isPending } =
    appConfigQuery.create.useMutation(queryClient);

  const handleAddNew = async (data: any) => {
    try {
      await mutateAsync(data);
      close();
    } catch (error: any) {
      showErrorNotification(error, false);
    }
  };
  return (
    <>
      <Button
        size="xs"
        leftSection={<TbPlus size={16} />}
        color="violet"
        onClick={open}
      >
        Add New
      </Button>
      <FormDialog title="Create New Config" open={opened} onClose={close}>
        <AppConfigForm
          newRecord
          schema={appConfigService.createRequestBodySchema}
          onSubmit={handleAddNew}
        >
          <Group justify="end">
            <Button color="violet" type="submit" loading={isPending}>
              Create
            </Button>
            <Button variant="subtle" color="dark" onClick={close}>
              Cancel
            </Button>
          </Group>
        </AppConfigForm>
      </FormDialog>
    </>
  );
};

export default AppConfigTableAddButton;

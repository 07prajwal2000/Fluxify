import { isAxiosError } from "axios";
import { ActionIcon, Button, Group, Menu } from "@mantine/core";
import React, { useState } from "react";
import { TbCopy, TbDots, TbDownload, TbEdit, TbTrash } from "react-icons/tb";
import ConfirmDialog from "./dialog/confirmDialog";
import { useDisclosure } from "@mantine/hooks";
import { routesService } from "@/services/routes";
import { showErrorNotification } from "@/lib/errorNotifier";
import { routesQueries } from "@/query/routerQuery";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useRouter } from "next/navigation";

type Proptypes = {
  id: string;
};

const RouteItemMenu = (props: Proptypes) => {
  const [opened, { open, close }] = useDisclosure(false);
  const client = useQueryClient();
  const router = useRouter();

  function onEditClicked() {
    router.push(`/editor/${props.id}/settings`);
  }
  function onDuplicateClicked() {}
  function onDownloadJsonClicked() {}
  async function onDeleteConfirm() {
    try {
      await routesService.delete(props.id);
      routesQueries.invalidateAll(client);
      notifications.show({
        message: "Successfully deleted",
        color: "green",
      });
    } catch (error: any) {
      showErrorNotification(error);
    }
    close();
  }

  return (
    <>
      <Menu position="bottom-end" width={200} shadow="md">
        <Menu.Target>
          <ActionIcon variant="subtle" color="dark">
            <TbDots size={20} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={onEditClicked} leftSection={<TbEdit size={20} />}>
            Edit
          </Menu.Item>
          <Menu.Item leftSection={<TbCopy size={20} />}>Duplicate</Menu.Item>
          <Menu.Item leftSection={<TbDownload size={20} />}>JSON</Menu.Item>
          <Menu.Item
            onClick={open}
            color="red"
            leftSection={<TbTrash size={20} />}
          >
            Delete
          </Menu.Item>
        </Menu.Dropdown>
        <ConfirmDialog
          onConfirm={onDeleteConfirm}
          open={opened}
          onClose={close}
          title="Confirm Delete?"
        >
          Are you sure want to delete?
        </ConfirmDialog>
      </Menu>
    </>
  );
};

export default RouteItemMenu;

"use client";

import { Button, Group } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React, { useState } from "react";
import FormDialog from "./dialog/formDialog";
import RouteForm from "./forms/routeForm";
import { routesService } from "@/services/routes";
import { routesQueries } from "@/query/routerQuery";
import { useQueryClient } from "@tanstack/react-query";

const CreateNewMenu = () => {
  const [opened, { open, close }] = useDisclosure(false);
  const [selectedItem, setSelectedItem] = useState("");

  function onMenuItemClicked(label: string) {
    setSelectedItem(label);
    open();
  }

  return (
    <Button.Group>
      <Button onClick={() => onMenuItemClicked("Route")} color="violet">
        Create Route
      </Button>
      <FormDialog
        title={`Create new ${selectedItem}`}
        open={opened}
        onClose={close}
      >
        {selectedItem === "Route" && <CreateRouteForm close={close} />}
      </FormDialog>
    </Button.Group>
  );
};

export function CreateRouteForm({ close }: { close?: () => void }) {
  const [loading, setLoading] = useState(false);
  const { invalidate: useInvalidate } = routesQueries.getAll;
  const client = useQueryClient();

  async function onSubmit(values: any) {
    try {
      await routesService.create(values);
      close?.();
      useInvalidate(client);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  }

  return (
    <RouteForm
      onSubmit={onSubmit}
      zodSchema={routesService.createRequestSchema}
      newForm
      actionSection={
        <Group gap={4} mt={"sm"} w={"fit-content"} ml={"auto"}>
          <Button
            loading={loading}
            type="submit"
            variant="outline"
            color="violet"
          >
            Submit
          </Button>
          <Button variant="subtle" color="dark">
            Cancel
          </Button>
        </Group>
      }
    />
  );
}

export default CreateNewMenu;

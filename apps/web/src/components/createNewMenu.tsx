"use client";

import { Button, Group, Menu } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React, { useState } from "react";
import { TbChevronDown, TbCloudCog, TbSquareKey } from "react-icons/tb";
import IntegrationForm from "./forms/integration";
import FormDialog from "./dialog/formDialog";
import AppConfigForm from "./forms/appConfig";
import RouteForm from "./forms/routeForm";
import { routesService } from "@/services/routes";
import { routesQueries } from "@/query/routerQuery";
import { useQueryClient } from "@tanstack/react-query";
import z from "zod";

const menuItems = [
  {
    label: "Integration",
    icon: <TbCloudCog size={20} />,
  },
  {
    label: "App Config",
    icon: <TbSquareKey size={20} />,
  },
];

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
      <Menu shadow="sm" width={250} position="bottom-end">
        <Menu.Target>
          <Button px={8} color="violet">
            <TbChevronDown size={20} />
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {menuItems.map((item, index) => (
            <Menu.Item
              onClick={() => onMenuItemClicked(item.label)}
              key={index}
              leftSection={item.icon}
            >
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      <FormDialog
        title={`Create new ${selectedItem}`}
        open={opened}
        onClose={close}
      >
        {selectedItem === "Integration" && <IntegrationForm onSubmit={close} />}
        {selectedItem === "App Config" && (
          <AppConfigForm schema={z.any()} onSubmit={close} />
        )}
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

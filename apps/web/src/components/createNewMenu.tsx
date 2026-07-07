"use client";

import { Button, Group } from "@mantine/core";
import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useLayoutStore } from "@/store/layout";

const CreateNewMenu = () => {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId?.toString();
  const { setSidebarOpened } = useLayoutStore();

  function onMenuItemClicked(label: string) {
    if (label === "Route") {
      setSidebarOpened(false);
      router.push(`/${projectId}/create-route`);
    }
  }

  return (
    <Button.Group>
      <Button onClick={() => onMenuItemClicked("Route")} color="violet">
        Create Route
      </Button>
    </Button.Group>
  );
};

export default CreateNewMenu;

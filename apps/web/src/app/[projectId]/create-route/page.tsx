"use client";

import React, { useState } from "react";
import { Box, Title, Container } from "@mantine/core";
import { RouteFormStepper, RouteFormValues } from "@/components/forms/RouteFormStepper";
import { routesService } from "@/services/routes";
import { useRouter, useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { routesQueries } from "@/query/routerQuery";
import { notifications } from "@mantine/notifications";
import { useLayoutStore } from "@/store/layout";

export default function CreateRoutePage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId?.toString() || "";
  const [loading, setLoading] = useState(false);
  const { invalidate: useInvalidate } = routesQueries.getAll;
  const client = useQueryClient();
  const { setSidebarOpened } = useLayoutStore();

  const handleSubmit = async (values: RouteFormValues) => {
    try {
      setLoading(true);
      await routesService.create({
        name: values.name,
        path: values.path,
        method: values.method as any,
        projectId,
        bodySchema: values.bodySchema,
        querySchema: values.querySchema,
        paramsSchema: values.paramsSchema,
        active: values.active,
      });
      notifications.show({
        title: "Success",
        message: "Route created successfully",
        color: "green",
      });
      useInvalidate(client);
      setSidebarOpened(true);
      router.push(`/${projectId}/routes`); // Redirect to routes list (or wherever is appropriate)
    } catch (error: any) {
      notifications.show({
        title: "Error creating route",
        message: error?.response?.data?.message || error.message || "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="xl" py="xl">
      <Box mb="xl">
        <Title order={2}>Create New Route</Title>
      </Box>
      <RouteFormStepper
        onSubmit={handleSubmit}
        loading={loading}
        onCancel={() => {
          setSidebarOpened(true);
          router.back();
        }}
      />
    </Container>
  );
}

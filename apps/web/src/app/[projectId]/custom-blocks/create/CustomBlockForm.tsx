"use client";

import React from "react";
import {
  Stack,
  TextInput,
  Textarea,
  Button,
  Group,
  Paper,
  Tabs,
  Image,
  Text,
  Center,
  SimpleGrid,
  ScrollArea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { customBlocksQueries } from "@/query/customBlocksQuery";
import { customBlocksService } from "@/services/customBlocks";
import { useRouter, useParams } from "next/navigation";
import { APP_ROUTES } from "@/constants/routes";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import InputParamsEditor from "./InputParamsEditor";
import CustomBlockIconSelector from "@/components/forms/CustomBlockIconSelector";

export default function CustomBlockForm({
  initialValues,
  isEdit,
  blockId,
}: {
  initialValues?: any;
  isEdit?: boolean;
  blockId?: string;
}) {
  const { projectId } = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();


  const form = useForm({
    initialValues: initialValues || {
      name: "",
      label: "",
      description: "",
      icon: "premade-list" as "premade-list" | "custom",
      iconUrl: "",
      inputParams: [],
    },
    validate: {
      name: (val) =>
        /^[a-z0-9_.]+$/.test(val)
          ? null
          : "Lowercase letters, numbers, dots, and underscores only",
      label: (val) => (val.length > 0 ? null : "Label is required"),
      iconUrl: (val, values) =>
        values.icon === "custom" && !val ? "Icon URL is required" : null,
    },
  });

  const mutation = useMutation({
    mutationFn: (values: typeof form.values) => {
      const payload = {
        ...values,
        projectId: projectId as string,
        inputParams: values.inputParams.map((param: any) => {
          if (param.type === "integration_selector") {
            return { ...param, tags: param.tags || [] };
          }
          if (param.type === "dropdown") {
            return { ...param, options: param.options || [] };
          }
          return param;
        }),
      };
      
      if (isEdit && blockId) {
        return customBlocksService.update(blockId, payload);
      }
      return customBlocksService.create(payload);
    },
    onSuccess: () => {
      customBlocksQueries.getAll.invalidate(queryClient, projectId as string);
      if (blockId) {
        customBlocksQueries.getById.invalidate(queryClient, blockId);
      }
      
      notifications.show({
        title: "Success",
        message: isEdit ? "Custom block updated successfully" : "Custom block created successfully",
        color: "green",
      });

      if (!isEdit) {
        router.push(APP_ROUTES.PROJECT_CUSTOM_BLOCKS(projectId as string));
      }
    },
  });

  return (
    <form onSubmit={form.onSubmit((values) => mutation.mutate(values))}>
      <Stack gap="xl">
        <Paper p="xl" withBorder radius="md">
          <Stack gap="md">
            <Text fw={600} size="lg">
              Basic Details
            </Text>
            <Group grow align="flex-start">
              <TextInput
                label="Name"
                placeholder="e.g. fetch_user_data"
                description={isEdit ? "This name is locked to prevent breaking any flows that are already using it." : "Choose carefully! This name cannot be changed later. We'll automatically prefix it based on the source type to prevent naming collisions (lowercase and underscores only)."}
                required
                disabled={isEdit}
                {...form.getInputProps("name")}
              />
              <TextInput
                label="Label"
                placeholder="e.g. Fetch User Data"
                required
                {...form.getInputProps("label")}
              />
            </Group>
            <Textarea
              label="Description"
              placeholder="What does this block do?"
              rows={3}
              {...form.getInputProps("description")}
            />
          </Stack>
        </Paper>

        <Paper p="xl" withBorder radius="md">
          <Stack gap="md">
            <Text fw={600} size="lg">
              Icon
            </Text>
            <CustomBlockIconSelector form={form} />
          </Stack>
        </Paper>

        <InputParamsEditor form={form} />

        <Group justify="flex-end" mt="xl">
          <Button
            variant="default"
            onClick={() =>
              router.push(APP_ROUTES.PROJECT_CUSTOM_BLOCKS(projectId as string))
            }
          >
            Cancel
          </Button>
          <Button
            type="submit"
            color="violet"
            loading={mutation.isPending}
          >
            {isEdit ? "Save Changes" : "Create Custom Block"}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

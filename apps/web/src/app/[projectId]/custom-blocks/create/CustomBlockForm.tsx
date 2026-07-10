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
import {
  TbBrandPython,
  TbBrandJavascript,
  TbDatabase,
  TbCloud,
  TbMail,
  TbMessage,
  TbApi,
  TbWebhook,
  TbLock,
  TbKey,
  TbSearch,
} from "react-icons/tb";

const premadeIcons = [
  { value: "python", icon: <TbBrandPython size={24} /> },
  { value: "javascript", icon: <TbBrandJavascript size={24} /> },
  { value: "database", icon: <TbDatabase size={24} /> },
  { value: "cloud", icon: <TbCloud size={24} /> },
  { value: "mail", icon: <TbMail size={24} /> },
  { value: "message", icon: <TbMessage size={24} /> },
  { value: "api", icon: <TbApi size={24} /> },
  { value: "webhook", icon: <TbWebhook size={24} /> },
  { value: "lock", icon: <TbLock size={24} /> },
  { value: "key", icon: <TbKey size={24} /> },
];

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
  const [iconSearch, setIconSearch] = React.useState("");

  const form = useForm({
    initialValues: initialValues || {
      name: "",
      label: "",
      description: "",
      icon: "premade-list" as "premade-list" | "custom",
      iconUrl: "",
      inputParams: [],
      sourceType: "inhouse" as const,
      source: "",
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
            <Tabs
              value={form.values.icon}
              onChange={(value) =>
                form.setFieldValue("icon", value as "premade-list" | "custom")
              }
              color="violet"
            >
              <Tabs.List>
                <Tabs.Tab value="premade-list">Premade</Tabs.Tab>
                <Tabs.Tab value="custom">Custom (Base64/URL)</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="premade-list" pt="md">
                <Stack gap="md">
                  <TextInput
                    placeholder="Search icons..."
                    leftSection={<TbSearch size={16} />}
                    value={iconSearch}
                    onChange={(e) => setIconSearch(e.currentTarget.value)}
                  />
                  <ScrollArea h={200}>
                    <SimpleGrid cols={5} spacing="md">
                      {premadeIcons
                        .filter((pi) =>
                          pi.value.toLowerCase().includes(iconSearch.toLowerCase())
                        )
                        .map((pi) => (
                          <Paper
                            key={pi.value}
                            withBorder
                            p="sm"
                            style={{
                              cursor: "pointer",
                              borderColor:
                                form.values.iconUrl === pi.value
                                  ? "var(--mantine-color-violet-filled)"
                                  : "var(--mantine-color-gray-3)",
                              backgroundColor:
                                form.values.iconUrl === pi.value
                                  ? "var(--mantine-color-violet-light)"
                                  : "transparent",
                            }}
                            onClick={() => form.setFieldValue("iconUrl", pi.value)}
                          >
                            <Center>{pi.icon}</Center>
                          </Paper>
                        ))}
                    </SimpleGrid>
                  </ScrollArea>
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="custom" pt="md">
                <Group align="flex-start" wrap="nowrap">
                  <Paper
                    withBorder
                    w={100}
                    h={100}
                    style={{ overflow: "hidden", display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fa', flexShrink: 0 }}
                  >
                    {form.values.iconUrl ? (
                      <Image
                        src={form.values.iconUrl}
                        w={100}
                        h={100}
                        fit="contain"
                        alt="Icon preview"
                      />
                    ) : (
                      <Text size="xs" c="dimmed">
                        100x100
                      </Text>
                    )}
                  </Paper>
                  <Textarea
                    label="Icon URL or Base64"
                    placeholder="data:image/svg+xml;base64,..."
                    flex={1}
                    rows={4}
                    {...form.getInputProps("iconUrl")}
                  />
                </Group>
              </Tabs.Panel>
            </Tabs>
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

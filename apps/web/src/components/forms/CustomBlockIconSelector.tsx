import React from "react";
import {
  Tabs,
  Image,
  Text,
  Center,
  SimpleGrid,
  ScrollArea,
  Paper,
  TextInput,
  Stack,
  Group,
  Textarea,
} from "@mantine/core";
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
import { UseFormReturnType } from "@mantine/form";

export const premadeIcons = [
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

export default function CustomBlockIconSelector({
  form,
}: {
  form: UseFormReturnType<any>;
}) {
  const [iconSearch, setIconSearch] = React.useState("");

  return (
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
        <Group align="center" wrap="nowrap">
          <Paper
            withBorder
            w={100}
            h={100}
            style={{
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#f8f9fa",
              flexShrink: 0,
            }}
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
  );
}
